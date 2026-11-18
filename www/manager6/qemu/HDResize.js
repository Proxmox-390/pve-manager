Ext.define('PVE.window.HDResize', {
    extend: 'Ext.window.Window',

    resizable: false,

    resize_disk: function (disk, size) {
        var me = this;
        var params = { disk: disk, size: '+' + size + 'G' };
        if (me.isCKD) {
            // a CKD volume grows by whole cylinders, the size is given in bytes
            params.size = '+' + size * PVE.qemu.DASDFields.cylinderSize;
        }

        Proxmox.Utils.API2Request({
            params: params,
            url: '/nodes/' + me.nodename + '/qemu/' + me.vmid + '/resize',
            waitMsgTarget: me,
            method: 'PUT',
            failure: function (response, opts) {
                Ext.Msg.alert(gettext('Error'), response.htmlStatus);
            },
            success: function (response, options) {
                Ext.create('Proxmox.window.TaskProgress', {
                    autoShow: true,
                    upid: response.result.data,
                });
                me.close();
            },
        });
    },

    initComponent: function () {
        var me = this;

        if (!me.nodename) {
            throw 'no node name specified';
        }

        if (!me.vmid) {
            throw 'no VM ID specified';
        }

        var items = [
            {
                xtype: 'displayfield',
                name: 'disk',
                value: me.disk,
                fieldLabel: gettext('Disk'),
                vtype: 'StorageId',
                allowBlank: false,
            },
        ];

        me.isCKD = !!me.disk.match(/^ckd\d+$/);

        me.hdsizesel = Ext.createWidget('numberfield', {
            name: 'size',
            minValue: 0,
            maxValue: 128 * 1024,
            decimalPrecision: 3,
            value: '0',
            fieldLabel: `${gettext('Size Increment')} (${gettext('GiB')})`,
            allowBlank: false,
        });
        if (me.isCKD) {
            // the VM must not run, the volume header gets the new cylinder count
            me.hdsizesel = Ext.createWidget('proxmoxintegerfield', {
                name: 'size',
                minValue: 1,
                maxValue: PVE.qemu.DASDFields.maxCylinders,
                value: 1,
                fieldLabel: gettext('Cylinders to add'),
                allowBlank: false,
            });
        }

        items.push(me.hdsizesel);

        me.formPanel = Ext.create('Ext.form.Panel', {
            bodyPadding: 10,
            border: false,
            fieldDefaults: {
                labelWidth: 140,
                anchor: '100%',
            },
            items: items,
        });

        var form = me.formPanel.getForm();

        var submitBtn;

        me.title = gettext('Resize disk');
        submitBtn = Ext.create('Ext.Button', {
            text: gettext('Resize disk'),
            handler: function () {
                if (form.isValid()) {
                    let values = form.getValues();
                    me.resize_disk(me.disk, values.size);
                }
            },
        });

        Ext.apply(me, {
            modal: true,
            width: 250,
            height: 150,
            border: false,
            layout: 'fit',
            buttons: [submitBtn],
            items: [me.formPanel],
        });

        me.callParent();
    },
});
