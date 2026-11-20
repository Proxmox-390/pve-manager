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
    // a task, in the task log
    showTaskViewer: true,

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

// s390x: set an online qeth network device of the node offline, now and persistently ('chzdev -d
// qeth'). Only devices the node does not use: the API refuses one with an interface in the network
// configuration or with the management address of the node, the list tells which ('in-use').
Ext.define('PVE.node.QethDisableWindow', {
    extend: 'Proxmox.window.Edit',
    alias: 'widget.pveNodeQethDisableWindow',

    subject: gettext('qeth Network Device'),
    isCreate: true,
    method: 'DELETE',
    submitText: gettext('Set Offline'),
    width: 560,
    showTaskViewer: true,

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
                fieldLabel: gettext('Device'),
                allowBlank: false,
                autoSelect: false,
                editable: false,
                valueField: 'device',
                displayField: 'id',
                emptyText: gettext('Loading...'),
                store: {
                    fields: ['id', 'device', 'online', 'persistent', 'names', 'in-use'],
                    proxy: {
                        type: 'proxmox',
                        url: `/api2/json/nodes/${me.nodename}/hardware/qeth`,
                    },
                    // only online devices can be set offline
                    filters: [(rec) => !!rec.data.online],
                },
                // a device the node uses cannot be set offline
                validator: function (value) {
                    let res = Proxmox.form.ComboGrid.prototype.validator.call(this, value);
                    if (res !== true || !value) {
                        return res;
                    }
                    let rec = this.getStore().findRecord(
                        'device',
                        this.getValue(),
                        0,
                        false,
                        true,
                        true,
                    );
                    let inUse = rec?.data['in-use'];
                    return inUse
                        ? Ext.String.format(gettext('In use: {0}'), Ext.htmlEncode(inUse))
                        : true;
                },
                listConfig: {
                    width: 520,
                    emptyText: gettext('No online qeth devices'),
                    columns: [
                        {
                            header: gettext('Device'),
                            dataIndex: 'device',
                            width: 90,
                        },
                        {
                            header: gettext('Interface'),
                            dataIndex: 'names',
                            width: 90,
                            renderer: (names) => Ext.htmlEncode((names ?? []).join(', ')),
                        },
                        {
                            header: gettext('In use'),
                            dataIndex: 'in-use',
                            flex: 1,
                            renderer: function (value, meta) {
                                if (!value) {
                                    return Proxmox.Utils.noText;
                                }
                                meta.tdAttr = `data-qtip="${Ext.htmlEncode(Ext.htmlEncode(value))}"`;
                                return Ext.htmlEncode(value);
                            },
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
                                        : gettext('No online qeth devices')
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
                userCls: 'pmx-hint',
                value: gettext(
                    'The network interface of the device goes away, now and at every boot. Devices with an interface in the network configuration of the node or with its management address cannot be set offline.',
                ),
            },
        ];

        me.callParent();
    },
});

// The network panel of a node; s390x nodes also get a menu to set qeth devices online (their
// interface appears in the list then) or offline.
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
        let openWindow = (cls) =>
            Ext.create(cls, {
                autoShow: true,
                nodename: me.nodename,
                listeners: {
                    destroy: () => me.down('gridpanel').getStore().load(),
                },
            });
        // after the Create menu
        tbar.insert(1, {
            xtype: 'button',
            itemId: 'qethMenu',
            text: gettext('qeth Device'),
            iconCls: 'fa fa-plug',
            tooltip: gettext('Set a qeth network device (OSA, HiperSockets) online or offline'),
            disabled: !caps?.nodes['Sys.Modify'],
            menu: [
                {
                    itemId: 'qethEnable',
                    text: gettext('Set Online'),
                    iconCls: 'fa fa-toggle-on',
                    handler: () => openWindow('PVE.node.QethEnableWindow'),
                },
                {
                    itemId: 'qethDisable',
                    text: gettext('Set Offline'),
                    iconCls: 'fa fa-toggle-off',
                    handler: () => openWindow('PVE.node.QethDisableWindow'),
                },
            ],
        });
    },
});
