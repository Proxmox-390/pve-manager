// A 3270 terminal of an s390x VM ('terminalN'): a CCW device the guest sees as a 3270 display,
// opened as a console with c3270.
Ext.define('PVE.qemu.TerminalInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    alias: 'widget.pveQemuTerminalInputPanel',

    onGetValues: function (values) {
        let me = this;

        let terminal = { devno: values.devno };
        if (values.model && values.model !== '__default__') {
            terminal.model = values.model;
        }
        return { [me.confid]: PVE.Parser.printPropertyString(terminal, 'devno') };
    },

    items: [
        {
            xtype: 'pveCcwDevnoField',
            name: 'devno',
            kind: '3270',
        },
        {
            xtype: 'proxmoxKVComboBox',
            name: 'model',
            fieldLabel: gettext('Model'),
            value: '__default__',
            deleteEmpty: false,
            comboItems: [
                ['__default__', gettext('Default') + ' (' + gettext('largest that fits') + ')'],
                ['2', '3279-2 (24x80)'],
                ['3', '3279-3 (32x80)'],
                ['4', '3279-4 (43x80)'],
                ['5', '3279-5 (27x132)'],
            ],
        },
    ],
});

Ext.define('PVE.qemu.TerminalEdit', {
    extend: 'Proxmox.window.Edit',

    isAdd: true,

    subject: gettext('3270 Terminal'),

    initComponent: function () {
        let me = this;

        let nodename = me.pveSelNode.data.node;
        let vmid = me.pveSelNode.data.vmid;

        me.isCreate = !me.confid;

        let ipanel = Ext.create('PVE.qemu.TerminalInputPanel', {
            confid: me.confid,
        });

        Ext.apply(me, {
            items: [ipanel],
        });

        me.callParent();

        me.load({
            success: function ({ result: { data } }) {
                if (me.isCreate) {
                    for (let i = 0; i < PVE.Utils.hardware_counts.terminal; i++) {
                        if (data[`terminal${i}`] === undefined) {
                            ipanel.confid = `terminal${i}`;
                            break;
                        }
                    }
                    if (!ipanel.confid) {
                        Ext.Msg.alert(gettext('Error'), gettext('No free 3270 terminal'));
                        me.close();
                        return;
                    }
                }
                ipanel.down('pveCcwDevnoField').setConfId(ipanel.confid);
                if (!me.isCreate) {
                    let terminal = PVE.Parser.parsePropertyString(data[me.confid], 'devno');
                    ipanel.setValues({
                        devno: terminal.devno,
                        model: terminal.model ?? '__default__',
                    });
                }
                ipanel.down('pveCcwDevnoField').setVMConfig(nodename, vmid);
            },
        });
    },
});
