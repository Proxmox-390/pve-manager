// Forwarding of the SCLP line-mode console of an s390x VM to a syslog server ('sclplm-syslog'):
// the guest's messages, the operator commands and the IPL markers, as RFC 5424 messages. It
// applies while the VM runs, no restart needed.
Ext.define('PVE.qemu.SclpSyslogInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    alias: 'widget.pveQemuSclpSyslogInputPanel',

    onGetValues: function (values) {
        if (!values.host) {
            return { delete: 'sclplm-syslog' };
        }
        let syslog = { host: values.host };
        if (values.proto && values.proto !== 'udp') {
            syslog.proto = values.proto;
        }
        if (values.port && Number(values.port) !== 514) {
            syslog.port = values.port;
        }
        if (values.facility && values.facility !== 'local0') {
            syslog.facility = values.facility;
        }
        return { 'sclplm-syslog': PVE.Parser.printPropertyString(syslog, 'host') };
    },

    setVMConfig: function (vmconfig) {
        let me = this;

        let syslog = PVE.Parser.parsePropertyString(vmconfig['sclplm-syslog'] ?? '', 'host');
        me.up('window').setValues({
            host: syslog.host ?? '',
            proto: syslog.proto ?? 'udp',
            port: syslog.port ?? '',
            facility: syslog.facility ?? 'local0',
        });
    },

    items: [
        {
            xtype: 'displayfield',
            userCls: 'pmx-hint',
            value: gettext(
                'Sends the messages of the guest, the commands entered and the IPL markers of the line-mode console. Leave the server empty to stop forwarding.',
            ),
        },
        {
            xtype: 'proxmoxtextfield',
            name: 'host',
            fieldLabel: gettext('Server'),
            emptyText: gettext('none'),
            vtype: 'DnsOrIp',
            deleteEmpty: false,
        },
        {
            xtype: 'proxmoxKVComboBox',
            name: 'proto',
            fieldLabel: gettext('Protocol'),
            deleteEmpty: false,
            value: 'udp',
            comboItems: [
                ['udp', 'UDP'],
                ['tcp', 'TCP'],
            ],
        },
        {
            xtype: 'proxmoxintegerfield',
            name: 'port',
            fieldLabel: gettext('Port'),
            minValue: 1,
            maxValue: 65535,
            emptyText: '514',
            deleteEmpty: false,
        },
    ],

    advancedItems: [
        {
            xtype: 'proxmoxKVComboBox',
            name: 'facility',
            fieldLabel: gettext('Facility'),
            deleteEmpty: false,
            value: 'local0',
            comboItems: [
                'kern', 'user', 'mail', 'daemon', 'auth', 'syslog', 'lpr', 'news', 'uucp',
                'cron', 'authpriv', 'ftp', 'local0', 'local1', 'local2', 'local3', 'local4',
                'local5', 'local6', 'local7',
            ].map((f) => [f, f]),
        },
    ],
});

Ext.define('PVE.qemu.SclpSyslogEdit', {
    extend: 'Proxmox.window.Edit',

    subject: gettext('Line-mode console syslog'),
    width: 480,

    items: [
        {
            xtype: 'pveQemuSclpSyslogInputPanel',
            itemId: 'inputpanel',
        },
    ],

    initComponent: function () {
        let me = this;
        me.callParent();
        me.load({
            success: ({ result }) => me.down('#inputpanel').setVMConfig(result.data),
        });
    },
});
