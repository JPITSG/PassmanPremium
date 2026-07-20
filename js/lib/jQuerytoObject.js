jQuery.fn.serializeObject = function()
{
    var o = {};
    var a = this.serializeArray();
    jQuery.each(a, function() {
        var value;
        if (o[this.name] !== undefined) {
            if (!o[this.name].push) {
                o[this.name] = [o[this.name]];
            }
            value = (this.value === 'on') ? true : this.value;
            value = (value === 'off') ? false : value;
            o[this.name].push(value || '');
        } else {
            value = (this.value === 'on') ? true : this.value;
            value = (value === 'off') ? false : value;
            o[this.name] = value;
        }
    });
    // serializeArray omits unchecked checkboxes entirely — persist them as
    // explicit false so a turned-off option survives the round-trip to
    // storage (generatePassword treats a missing key as its default,
    // which for most character classes is true)
    this.find('input[type=checkbox]:not(:checked)').each(function () {
        if (this.name && o[this.name] === undefined) {
            o[this.name] = false;
        }
    });
    return o;
};
