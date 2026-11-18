// IPL (initial program load) settings of s390x VMs with a non-Linux OS type, which IPL directly
// from a CCW device: the device and an optional load parameter.
Ext.define('PVE.qemu.IPLInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    alias: 'widget.pveQemuIPLInputPanel',

    onGetValues: function (values) {
        if (!values.device) {
            return { delete: 'ipl' };
        }
        let ipl = { device: values.device };
        if (values.loadparm) {
            ipl.loadparm = values.loadparm;
        }
        return { ipl: PVE.Parser.printPropertyString(ipl, 'device') };
    },

    setVMConfig: function (vmconfig) {
        let me = this;

        let isCloudinit = (v) => v.match(/media=cdrom/) && v.match(/[:/]vm-\d+-cloudinit/);
        let disks = Object.keys(vmconfig)
            .filter((key) => PVE.Utils.bus_match.test(key) && !isCloudinit(vmconfig[key]))
            .sort()
            .map((key) => [key, `${key} (${vmconfig[key].split(',')[0]})`]);
        me.down('field[name=device]').setComboItems([
            ['__default__', Proxmox.Utils.defaultText],
            ...disks,
        ]);

        let ipl = PVE.Parser.parsePropertyString(vmconfig.ipl ?? '', 'device');
        me.up('window').setValues({
            device: ipl.device ?? '__default__',
            loadparm: ipl.loadparm ?? '',
        });
    },

    items: [
        {
            xtype: 'proxmoxKVComboBox',
            name: 'device',
            fieldLabel: gettext('IPL device'),
            deleteEmpty: false,
            value: '__default__',
            comboItems: [['__default__', Proxmox.Utils.defaultText]],
            listeners: {
                change: function (field, value) {
                    field
                        .up('inputpanel')
                        .down('field[name=loadparm]')
                        .setDisabled(!value || value === '__default__');
                },
            },
        },
        {
            xtype: 'textfield',
            name: 'loadparm',
            fieldLabel: gettext('Load parameter'),
            emptyText: gettext('none'),
            disabled: true,
            maxLength: 8,
            enforceMaxLength: true,
            regex: /^[A-Z0-9. ]*$/,
            regexText: gettext('Letters A-Z, digits 0-9, dots and spaces only'),
            listeners: {
                change: function (field, value) {
                    let upper = value?.toUpperCase();
                    if (upper !== value) {
                        field.setValue(upper);
                    }
                },
            },
        },
    ],
});

Ext.define('PVE.qemu.IPLEdit', {
    extend: 'Proxmox.window.Edit',

    items: [
        {
            xtype: 'pveQemuIPLInputPanel',
            itemId: 'inputpanel',
        },
    ],

    subject: 'IPL',

    initComponent: function () {
        let me = this;
        me.callParent();
        me.load({
            success: ({ result }) => me.down('#inputpanel').setVMConfig(result.data),
        });
    },
});
