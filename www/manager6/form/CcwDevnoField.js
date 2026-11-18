// The device number (address) of a CCW device of an s390x VM, as the guest sees it:
// 0.<ssid>.<devno>, e.g. 0.0.0200. Required. When empty after creation, it is filled with the
// next free device number of its 'kind' that qemu-server suggests (GET ccw-devnos), which also
// works before the VM exists (creation wizard).
//
// Config:
//   kind: the device kind of qemu-server's device number scheme (fba, ckd, qeth, tape, 3270)
//   nodename, vmid: the VM (need not exist yet)
//   getUsedDevnos: optional function returning device numbers to treat as used, e.g. those
//       of devices added in the wizard but not created yet
//   autoSuggest: fill in the suggestion when the field is empty (default true); call
//       suggest() to (re)load it explicitly, e.g. after setting the vmid
//   count: the consecutive device numbers the device(s) use from this one (qeth: 3)
//
// In the creation wizard, the device numbers of the other address fields of the wizard count as
// used too: the suggestion skips them and the field is invalid if it overlaps one.
Ext.define('PVE.form.CcwDevnoField', {
    extend: 'Ext.form.field.Text',
    alias: ['widget.pveCcwDevnoField'],

    statics: {
        // 0.<ssid>.<devno> of 'count' consecutive device numbers from 'value', [] if invalid
        expand: function (value, count) {
            let match = /^(?:0\.([0-3])\.)?([0-9a-f]{1,4})$/i.exec(value ?? '');
            if (!match) {
                return [];
            }
            let [, ssid = '0', devno] = match;
            let first = parseInt(devno, 16);
            let res = [];
            for (let i = 0; i < (count ?? 1) && first + i <= 0xffff; i++) {
                res.push(`0.${ssid}.${(first + i).toString(16).padStart(4, '0')}`);
            }
            return res;
        },
    },

    fieldLabel: gettext('Address'),
    emptyText: '0.0.xxxx',
    allowBlank: false,

    kind: undefined,
    nodename: undefined,
    vmid: undefined,
    getUsedDevnos: undefined,
    autoSuggest: true,
    count: 1,

    // the device numbers of the other address fields of the creation wizard
    getWizardDevnos: function () {
        let me = this;
        let wizard = me.up('pveQemuCreateWizard');
        if (!wizard) {
            return [];
        }
        return wizard
            .query('pveCcwDevnoField')
            .filter((field) => field !== me && !field.isDisabled())
            .flatMap((field) => PVE.form.CcwDevnoField.expand(field.getValue(), field.count));
    },

    setCount: function (count) {
        let me = this;
        me.count = count;
        me.validate();
    },

    validator: function (value) {
        let me = this;
        let used = me.getWizardDevnos();
        let own = PVE.form.CcwDevnoField.expand(value, me.count);
        if (own.some((devno) => used.includes(devno))) {
            return gettext('The address is used by another device of the VM');
        }
        return true;
    },

    // like qemu-server: 0.<ssid>.<devno> or just the 3 or 4 hex digits of the device number
    regex: /^(?:0\.[0-3]\.[0-9a-fA-F]{1,4}|[0-9a-fA-F]{3,4})$/,
    regexText: gettext('Expected a device number like 0.0.0200'),

    setVMConfig: function (nodename, vmid) {
        let me = this;
        me.nodename = nodename;
        me.vmid = vmid;
        if (me.autoSuggest && !me.getValue()) {
            me.suggest();
        }
    },

    setKind: function (kind) {
        let me = this;
        let changed = me.kind !== kind;
        me.kind = kind;
        if (changed && me.autoSuggest && (!me.getValue() || me.suggestedValue === me.getValue())) {
            me.suggest(true);
        }
    },

    // Load the next free device number. Only replaces a value the user typed if 'force' is set.
    suggest: function (force) {
        let me = this;
        if (!me.kind || !me.nodename || !me.vmid) {
            return;
        }
        let params = { kind: me.kind };
        let used = me.getUsedDevnos ? me.getUsedDevnos() : [];
        used = [...(used || []), ...me.getWizardDevnos()].filter((devno) => !!devno);
        if (used.length) {
            params.used = used.join(',');
        }
        Proxmox.Utils.API2Request({
            url: `/nodes/${me.nodename}/qemu/${me.vmid}/ccw-devnos`,
            method: 'GET',
            params,
            success: function (response) {
                let suggested = response.result.data.suggested;
                if (!suggested || me.isDestroyed) {
                    return;
                }
                if (force || !me.getValue() || me.getValue() === me.suggestedValue) {
                    me.suggestedValue = suggested;
                    me.setValue(suggested);
                }
            },
        });
    },

    initComponent: function () {
        let me = this;
        me.callParent();
        if (me.autoSuggest && !me.getValue()) {
            me.suggest();
        }
    },
});
