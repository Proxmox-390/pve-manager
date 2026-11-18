Ext.define('PVE.qemu.CIDriveInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    xtype: 'pveCIDriveInputPanel',

    insideWizard: false,

    vmconfig: {}, // used to select usused disks

    onGetValues: function (values) {
        var _me = this;

        var drive = {};
        var params = {};
        drive.file = values.hdstorage + ':cloudinit';
        drive.format = values.diskformat;
        if (values.controller === 'fba') {
            drive.devno = values.devno; // s390x
        }
        params[values.controller + values.deviceid] = PVE.Parser.printQemuDrive(drive);
        return params;
    },

    setNodename: function (nodename) {
        var me = this;
        me.down('#hdstorage').setNodename(nodename);
        me.down('#drive').setNodename(nodename);
        me.down('#hdimage').setStorage(undefined, nodename);
    },

    setVMConfig: function (config) {
        var me = this;
        me.down('#drive').setVMConfig(config, 'cdrom');

        // s390x has no IDE or SATA, its cloud-init drive is an FBA DASD with a device number
        let arch = PVE.qemu.Architecture.getGuestArchitecture(config.arch, me.nodename);
        let s390x = arch === 's390x';
        let bus = me.down('#drive').down('field[name=controller]');
        if (s390x) {
            bus.setValue('fba');
        }
        bus.setReadOnly(s390x);
        let devno = me.down('pveCcwDevnoField');
        devno.setVisible(s390x);
        devno.setDisabled(!s390x);
        if (s390x) {
            devno.setVMConfig(me.nodename, me.vmid);
        }
    },

    initComponent: function () {
        var me = this;

        me.drive = {};

        me.items = [
            {
                xtype: 'pveControllerSelector',
                withVirtIO: false,
                itemId: 'drive',
                fieldLabel: gettext('CloudInit Drive'),
                nodename: me.nodename,
                name: 'drive',
            },
            {
                xtype: 'pveCcwDevnoField',
                name: 'devno',
                kind: 'fba',
                hidden: true,
                disabled: true,
            },
            {
                xtype: 'pveDiskStorageSelector',
                itemId: 'storselector',
                storageContent: 'images',
                nodename: me.nodename,
                hideSize: true,
            },
        ];
        me.callParent();
    },
});

Ext.define('PVE.qemu.CIDriveEdit', {
    extend: 'Proxmox.window.Edit',
    xtype: 'pveCIDriveEdit',

    isCreate: true,
    subject: gettext('CloudInit Drive'),

    initComponent: function () {
        var me = this;

        var nodename = me.pveSelNode.data.node;
        if (!nodename) {
            throw 'no node name specified';
        }

        me.items = [
            {
                xtype: 'pveCIDriveInputPanel',
                itemId: 'cipanel',
                nodename: nodename,
                vmid: me.pveSelNode.data.vmid,
            },
        ];

        me.callParent();

        me.load({
            success: function (response, opts) {
                me.down('#cipanel').setVMConfig(response.result.data);
            },
        });
    },
});
