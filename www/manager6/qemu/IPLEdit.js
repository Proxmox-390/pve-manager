// IPL (initial program load) settings of s390x VMs with a non-Linux OS type, which IPL directly
// from a CCW device: the device, one of the IPL-capable CCW devices qemu-server lists for the VM,
// and an optional load parameter.
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

    // ipl-devices: [{ key, type, devno, description }], the IPL-capable CCW devices of the VM
    setIPLDevices: function (devices) {
        let me = this;

        let items = devices.map(({ key, type, devno, description }) => {
            let details = [type, devno].filter((v) => v).join(', ');
            let text = details ? `${key} (${details})` : key;
            return [key, description ? `${text}: ${description}` : text];
        });
        // the VM config may have been loaded already: keep its value, and the field undirty
        let field = me.down('field[name=device]');
        let value = field.getValue();
        let wasDirty = field.isDirty();
        field.setComboItems([['__default__', Proxmox.Utils.defaultText], ...items]);
        field.setValue(value);
        if (!wasDirty) {
            field.resetOriginalValue();
        }
    },

    setVMConfig: function (vmconfig) {
        let me = this;

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
        let inputPanel = me.down('#inputpanel');
        Proxmox.Utils.API2Request({
            url: me.url.replace(/\/config$/, '/ipl-devices'),
            method: 'GET',
            failure: (response) => Ext.Msg.alert(gettext('Error'), response.htmlStatus),
            success: ({ result }) => {
                if (!me.destroyed) {
                    inputPanel.setIPLDevices(result.data ?? []);
                }
            },
        });
        me.load({
            success: ({ result }) => inputPanel.setVMConfig(result.data),
        });
    },
});
