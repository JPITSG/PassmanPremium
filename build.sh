#!/usr/bin/env bash
#
# build.sh — produce a Passman Premium package.
#
# Passman Premium is listed on addons.mozilla.org, so the installable
# artifact is the Mozilla-signed build AMO produced from the submitted
# source — signing is done by Mozilla and cannot be reproduced locally.
# `signed` (the default) fetches that artifact; `package` builds the
# unsigned zip you submit or side-load during development.
#
#   ./build.sh signed     download the AMO-signed xpi for manifest.json's
#                         version -> passman-premium.xpi          (default)
#   ./build.sh package    build the unsigned zip from source
#                         -> passman-premium-unsigned.xpi
#   ./build.sh verify     check this working tree against the signed build
#   ./build.sh submit     upload a new version to the AMO listed channel
#
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# Files that make up the extension, in the order they are packaged.
PACKAGE_FILES=(css fonts html icons js _locales LICENSE PRIVACY.md manifest.json)

SIGNED_XPI="passman-premium.xpi"
UNSIGNED_XPI="passman-premium-unsigned.xpi"
ARTIFACTS_DIR="web-ext-artifacts"
CREDENTIALS=".amo-credentials"
AMO_API="https://addons.mozilla.org/api/v5"

TMP=""
cleanup() {
	if [ -n "$TMP" ]; then rm -rf "$TMP"; fi
}
trap cleanup EXIT

die()  { printf 'build.sh: %s\n' "$*" >&2; exit 1; }
info() { printf '  %s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }

need() { command -v "$1" >/dev/null 2>&1 || die "required tool not found: $1"; }

manifest_field() {
	python3 - "$1" <<-'PY'
		import json, sys
		m = json.load(open("manifest.json"))
		if sys.argv[1] == "version":
		    print(m["version"])
		else:
		    settings = m.get("browser_specific_settings") or m.get("applications") or {}
		    print(settings.get("gecko", {}).get("id", ""))
	PY
}

# ---------------------------------------------------------------- package ---

# Build the unsigned zip from source. -X drops platform extra fields so the
# archive depends only on file contents.
cmd_package() {
	need zip
	local version; version="$(manifest_field version)"

	step "Packaging $version from source"
	# zip updates an existing archive in place; start clean every time.
	rm -f "$UNSIGNED_XPI"
	zip -q -r -X "$UNSIGNED_XPI" "${PACKAGE_FILES[@]}"

	info "wrote $UNSIGNED_XPI ($(du -h "$UNSIGNED_XPI" | cut -f1))"
	info "unsigned — for AMO submission or about:debugging, not for install"
}

# ----------------------------------------------------------------- signed ---

# Look up one published version through the public AMO API. Listed versions
# are world-readable, so this needs no credentials.
# Prints url, sha256 hash and file status, one per line.
# Exits 2 if AMO could not be reached, 3 if it has no such version.
amo_version_file() {
	local guid="$1" version="$2" json rc=0
	json="$(mktemp)"

	# The response goes to a file, not a pipe: `python3 -` takes its program
	# on stdin, which would consume the pipe before the program could read it.
	curl -fsSL --max-time 60 -o "$json" \
		"$AMO_API/addons/addon/$guid/versions/?page_size=50" || rc=2

	if [ $rc -eq 0 ]; then
		python3 - "$json" "$version" <<-'PY' || rc=$?
			import json, sys
			want = sys.argv[2]
			for v in json.load(open(sys.argv[1])).get("results", []):
			    if v["version"] == want:
			        f = v.get("file") or {}
			        print(f.get("url", ""))
			        print(f.get("hash", "").removeprefix("sha256:"))
			        print(f.get("status", ""))
			        sys.exit(0)
			sys.exit(3)
		PY
	fi

	rm -f "$json"
	return $rc
}

cmd_signed() {
	need curl; need unzip; need sha256sum
	local guid version url want_hash status
	guid="$(manifest_field id)"
	version="$(manifest_field version)"
	[ -n "$guid" ] || die "no gecko id in manifest.json"

	step "Fetching the Mozilla-signed build of $version"

	local lines rc=0
	lines="$(amo_version_file "$guid" "$version")" || rc=$?
	case $rc in
		0) ;;
		2) die "could not reach the AMO API at $AMO_API" ;;
		*) die "$version is not published on AMO.

Only versions Mozilla has approved can be fetched. Submit this one first:
    ./build.sh submit
then re-run once review completes. Review status:
    https://addons.mozilla.org/developers/addon/$guid/versions" ;;
	esac
	{ read -r url; read -r want_hash; read -r status; } <<<"$lines"

	[ "$status" = "public" ] || die "AMO has $version but its file status is '$status', not 'public'"

	TMP="$(mktemp -d)"
	local download="$TMP/${url##*/}"
	curl -fSL --max-time 300 --progress-bar -o "$download" "$url"

	# 1. The bytes are the ones AMO recorded for this version.
	local got_hash; got_hash="$(sha256sum "$download" | cut -d' ' -f1)"
	[ "$got_hash" = "$want_hash" ] \
		|| die "sha256 mismatch: got $got_hash, AMO published $want_hash"

	# 2. Mozilla's signature is actually in the archive.
	unzip -l "$download" | grep -q 'META-INF/mozilla.rsa' \
		|| die "no Mozilla signature in the downloaded package"

	# 3. It is the version we asked for.
	local packaged; packaged="$(unzip -p "$download" manifest.json | manifest_version_of_stdin)"
	[ "$packaged" = "$version" ] \
		|| die "package declares version $packaged, expected $version"

	mkdir -p "$ARTIFACTS_DIR"
	cp "$download" "$ARTIFACTS_DIR/${url##*/}"
	cp "$download" "$SIGNED_XPI"

	info "sha256 $got_hash (matches AMO)"
	info "signed by Mozilla — META-INF/mozilla.rsa present"
	info "wrote $SIGNED_XPI and $ARTIFACTS_DIR/${url##*/}"

	step "Checking this working tree against the signed build"
	if compare_payload "$download"; then
		info "identical — the signed build is this source"
	else
		info ""
		info "The signed build is genuine, but it is NOT this working tree."
		info "Installing it will not include the changes above."
	fi

	step "Install"
	info "about:addons -> gear -> Install Add-on From File... -> $SIGNED_XPI"
}

manifest_version_of_stdin() {
	python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])'
}

# ----------------------------------------------------------------- verify ---

# Compare an xpi's payload (everything but Mozilla's signature) against the
# working tree. Returns non-zero if they differ.
compare_payload() {
	local xpi="$1"
	local work; work="$(mktemp -d)"
	local rc=0

	# The payload gets its own subdirectory so the listings below, which live
	# in $work, are not themselves picked up as package contents.
	unzip -q "$xpi" -d "$work/payload"
	rm -rf "$work/payload/META-INF"

	# sort and comm must agree on collation, so pin both to the C locale.
	(cd "$work/payload" && find . -type f | sed 's|^\./||' | LC_ALL=C sort) >"$work/packaged"
	(cd "$ROOT" && find "${PACKAGE_FILES[@]}" -type f | LC_ALL=C sort) >"$work/local"

	local f
	while read -r f; do
		info "only in the package: $f"; rc=1
	done < <(LC_ALL=C comm -23 "$work/packaged" "$work/local")
	while read -r f; do
		info "only in the working tree: $f"; rc=1
	done < <(LC_ALL=C comm -13 "$work/packaged" "$work/local")

	while read -r f; do
		if ! cmp -s "$work/payload/$f" "$ROOT/$f"; then
			info "differs: $f"; rc=1
		fi
	done < <(LC_ALL=C comm -12 "$work/packaged" "$work/local")

	rm -rf "$work"
	return $rc
}

cmd_verify() {
	need curl; need unzip; need sha256sum
	local version; version="$(manifest_field version)"

	[ -f "$SIGNED_XPI" ] || die "$SIGNED_XPI not found — run ./build.sh signed first"

	step "Verifying $SIGNED_XPI against the working tree"
	local packaged; packaged="$(unzip -p "$SIGNED_XPI" manifest.json | manifest_version_of_stdin)"
	[ "$packaged" = "$version" ] \
		|| die "$SIGNED_XPI is version $packaged but manifest.json says $version — re-run ./build.sh signed"

	unzip -l "$SIGNED_XPI" | grep -q 'META-INF/mozilla.rsa' \
		|| die "$SIGNED_XPI carries no Mozilla signature"

	if compare_payload "$SIGNED_XPI"; then
		info "$version: signed package and working tree are identical"
	else
		die "the signed package does not match this working tree (see above)"
	fi
}

# ----------------------------------------------------------------- submit ---

# Versions are consumed permanently per add-on across BOTH channels, so a
# number that already exists can never be reused. Check before uploading.
amo_version_exists() {
	local guid="$1" version="$2"
	[ -f "$CREDENTIALS" ] || return 1
	(
		set -a; . "./$CREDENTIALS"; set +a
		python3 - "$guid" "$version" <<-'PY'
			import base64, hashlib, hmac, json, os, sys, time, urllib.request, urllib.error

			def seg(b): return base64.urlsafe_b64encode(b).rstrip(b"=")

			now = int(time.time())
			head = seg(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
			load = seg(json.dumps({"iss": os.environ["WEB_EXT_API_KEY"], "jti": os.urandom(8).hex(),
			                       "iat": now, "exp": now + 300}).encode())
			body = head + b"." + load
			sig = seg(hmac.new(os.environ["WEB_EXT_API_SECRET"].encode(), body, hashlib.sha256).digest())

			guid, want = sys.argv[1], sys.argv[2]
			url = (f"https://addons.mozilla.org/api/v5/addons/addon/{guid}"
			       "/versions/?filter=all_with_unlisted&page_size=50")
			req = urllib.request.Request(url, headers={"Authorization": "JWT " + (body + b"." + sig).decode()})
			try:
			    with urllib.request.urlopen(req, timeout=60) as r:
			        versions = json.load(r).get("results", [])
			except urllib.error.HTTPError:
			    sys.exit(2)          # cannot tell — let the caller decide
			for v in versions:
			    if v["version"] == want:
			        print(v.get("channel", "?"))
			        sys.exit(0)
			sys.exit(1)
		PY
	)
}

cmd_submit() {
	need curl; need unzip
	local guid version
	guid="$(manifest_field id)"
	version="$(manifest_field version)"

	[ -f "$CREDENTIALS" ] || die "$CREDENTIALS not found — AMO API key and secret are required to submit"

	local web_ext
	if command -v web-ext >/dev/null 2>&1; then
		web_ext=(web-ext)
	elif command -v npx >/dev/null 2>&1; then
		web_ext=(npx --yes web-ext)
	else
		die "web-ext not found — install it outside this repo, or provide npx"
	fi

	step "Checking whether $version is still available"
	local existing rc=0
	existing="$(amo_version_exists "$guid" "$version")" || rc=$?
	case $rc in
		0) die "AMO already has version $version on the $existing channel.

Version numbers are consumed permanently, across both channels. Bump
\"version\" in manifest.json and try again." ;;
		2) info "could not reach the AMO API — continuing, AMO will reject a duplicate" ;;
		*) info "$version is unused" ;;
	esac

	# Never sign the repo directory itself: that risks packaging .git,
	# credentials or other untracked files. Stage from a fresh unsigned zip.
	step "Staging a clean copy"
	cmd_package
	TMP="$(mktemp -d)"
	unzip -q "$UNSIGNED_XPI" -d "$TMP/src"
	info "staged $(find "$TMP/src" -type f | wc -l) files"

	step "Uploading $version to the listed channel"
	mkdir -p "$ARTIFACTS_DIR"
	(
		set -a; . "./$CREDENTIALS"; set +a
		"${web_ext[@]}" sign --source-dir="$TMP/src" \
			--channel=listed \
			--artifacts-dir="./$ARTIFACTS_DIR"
	)

	step "Submitted"
	info "Listed submissions go through Mozilla review. Once approved, run"
	info "./build.sh signed to fetch the signed build."
	info "https://addons.mozilla.org/developers/addon/$guid/versions"
}

# ------------------------------------------------------------------- main ---

case "${1:-signed}" in
	signed|"")  cmd_signed ;;
	package)    cmd_package ;;
	verify)     cmd_verify ;;
	submit)     cmd_submit ;;
	-h|--help|help)
		# The header comment, minus the shebang, is the usage text.
		awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "${BASH_SOURCE[0]}"
		;;
	*) die "unknown command: $1 (try: signed, package, verify, submit)" ;;
esac
