// s390x: set an offline qeth network device (OSA-Express, HiperSockets) of the node online, so that
// it gets a network interface: in layer 2 mode, now and persistently ('chzdev -e qeth'). Only
// qeth devices are offered (no FCP or DASD devices), only those that are offline.
Ext.define('PVE.node.QethEnableWindow', {
    extend: 'Proxmox.window.Edit',
    alias: 'widget.pveNodeQethEnableWindow',

    subject: gettext('qeth Network Device'),
    isCreate: true,
    method: 'POST',
    submitText: gettext('Set Online'),
    width: 520,

    initComponent: function () {
        let me = this;

        if (!me.nodename) {
            throw 'no node name specified';
        }
        me.url = `/nodes/${me.nodename}/hardware/qeth`;

        me.items = [
            {
                xtype: 'proxmoxComboGrid',
                name: 'device',
                reference: 'device',
                fieldLabel: gettext('Device'),
                allowBlank: false,
                autoSelect: false,
                editable: false,
                valueField: 'device',
                displayField: 'id',
                emptyText: gettext('Loading...'),
                store: {
                    fields: ['id', 'device', 'online', 'persistent', 'names'],
                    proxy: {
                        type: 'proxmox',
                        url: `/api2/json/nodes/${me.nodename}/hardware/qeth`,
                    },
                    // only offline devices can be set online
                    filters: [(rec) => !rec.data.online],
                },
                listConfig: {
                    width: 420,
                    emptyText: gettext('No offline qeth devices'),
                    columns: [
                        {
                            header: gettext('Device'),
                            dataIndex: 'device',
                            width: 90,
                        },
                        {
                            header: gettext('CCW group'),
                            dataIndex: 'id',
                            flex: 1,
                        },
                        {
                            header: gettext('Persistent'),
                            dataIndex: 'persistent',
                            width: 90,
                            renderer: Proxmox.Utils.format_boolean,
                        },
                    ],
                },
                listeners: {
                    afterrender: function (field) {
                        field.getStore().load({
                            callback: function (records, operation, success) {
                                if (field.destroyed) {
                                    return;
                                }
                                let count = field.getStore().getCount();
                                field.emptyText = success
                                    ? count
                                        ? ''
                                        : gettext('No offline qeth devices')
                                    : gettext('Error');
                                field.setEmptyText(field.emptyText);
                                if (!success) {
                                    field.markInvalid(operation.getError()?.statusText);
                                }
                            },
                        });
                    },
                },
            },
            {
                xtype: 'displayfield',
                fieldLabel: gettext('Mode'),
                value: gettext('Layer 2'),
            },
            {
                xtype: 'proxmoxcheckbox',
                name: 'bridge-port',
                fieldLabel: gettext('Bridge port'),
                boxLabel: gettext('Reflect the promiscuous mode of the bridge'),
                uncheckedValue: 0,
                checked: true,
            },
            {
                xtype: 'displayfield',
                userCls: 'pmx-hint',
                value: gettext(
                    'The device gets a network interface (e.g. enc610), now and at every boot. Use it as the port of a bridge for guests: the OSA then passes the frames for the MAC addresses of the guests to the node (bridge_reflect_promisc=primary).',
                ),
            },
        ];

        me.callParent();
    },
});

// The network panel of a node; s390x nodes also get a button to set an offline qeth device online
// (its interface appears in the list then).
Ext.define('PVE.node.NetworkView', {
    extend: 'Proxmox.node.NetworkView',
    alias: 'widget.pveNodeNetworkView',

    initComponent: function () {
        let me = this;

        me.callParent();

        if (PVE.qemu.Architecture.getNodeArchitecture(me.nodename) !== 's390x') {
            return;
        }
        let caps = Ext.state.Manager.get('GuiCap');
        let tbar = me.getDockedItems('toolbar[dock="top"]')[0];
        // after the Create menu
        tbar.insert(1, {
            xtype: 'button',
            itemId: 'qethEnable',
            text: gettext('qeth Device'),
            iconCls: 'fa fa-plug',
            tooltip: gettext('Set an offline qeth network device (OSA, HiperSockets) online'),
            disabled: !caps?.nodes['Sys.Modify'],
            handler: function () {
                Ext.create('PVE.node.QethEnableWindow', {
                    autoShow: true,
                    nodename: me.nodename,
                    listeners: {
                        destroy: () => me.down('gridpanel').getStore().load(),
                    },
                });
            },
        });
    },
});
