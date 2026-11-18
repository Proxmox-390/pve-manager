Ext.define('PVE.button.ConsoleButton', {
    extend: 'Ext.button.Split',
    alias: 'widget.pveConsoleButton',

    consoleType: 'shell', // one of 'shell', 'kvm', 'lxc', 'upgrade', 'cmd'

    cmd: undefined,

    consoleName: undefined,

    iconCls: 'fa fa-terminal',

    enableSpice: true,
    enableXtermjs: true,

    // VM serial terminals offered instead of the viewers, see setSerialConsoles
    serialConsoles: undefined,

    nodename: undefined,

    vmid: 0,

    text: gettext('Console'),

    setEnableSpice: function (enable) {
        var me = this;

        me.enableSpice = enable;
        me.down('#spicemenu').setDisabled(!enable);
    },

    setEnableXtermJS: function (enable) {
        var me = this;

        me.enableXtermjs = enable;
        me.down('#xtermjs').setDisabled(!enable);
    },

    // Offer the given serial terminals of a VM, each opened with xterm.js, instead of the
    // viewers; the first one is the default. Used for s390x VMs, which have SCLP and 3270
    // consoles instead of a VGA display.
    // consoles: [{ serial: <serial terminal interface>, text: <menu entry> }]
    setSerialConsoles: function (consoles) {
        let me = this;

        me.serialConsoles = consoles;
        let menu = me.getMenu();
        menu.query('menuitem[serial]').forEach((item) => menu.remove(item));
        ['#novnc', '#spicemenu', '#xtermjs'].forEach((id) => me.down(id).setHidden(true));
        menu.add(
            consoles.map(({ serial, text }) => ({
                text,
                serial,
                iconCls: 'pve-itype-icon-xtermjs',
                handler: () => me.openConsole('xtermjs', serial),
            })),
        );
    },

    handler: function () {
        // main, general, handler
        let me = this;
        if (me.serialConsoles) {
            me.openConsole('xtermjs', me.serialConsoles[0].serial);
            return;
        }
        PVE.Utils.openDefaultConsoleWindow(
            {
                spice: me.enableSpice,
                xtermjs: me.enableXtermjs,
            },
            me.consoleType,
            me.vmid,
            me.nodename,
            me.consoleName,
            me.cmd,
        );
    },

    openConsole: function (types, serial) {
        // used by split-menu buttons
        let me = this;
        PVE.Utils.openConsoleWindow(
            types,
            me.consoleType,
            me.vmid,
            me.nodename,
            me.consoleName,
            me.cmd,
            serial,
        );
    },

    menu: [
        {
            xtype: 'menuitem',
            itemId: 'novnc',
            text: 'noVNC',
            iconCls: 'pve-itype-icon-novnc',
            type: 'html5',
            handler: function (button) {
                let view = this.up('button');
                view.openConsole(button.type);
            },
        },
        {
            xterm: 'menuitem',
            itemId: 'spicemenu',
            text: 'SPICE',
            type: 'vv',
            iconCls: 'pve-itype-icon-virt-viewer',
            handler: function (button) {
                let view = this.up('button');
                view.openConsole(button.type);
            },
        },
        {
            text: 'xterm.js',
            itemId: 'xtermjs',
            iconCls: 'pve-itype-icon-xtermjs',
            type: 'xtermjs',
            handler: function (button) {
                let view = this.up('button');
                view.openConsole(button.type);
            },
        },
    ],

    initComponent: function () {
        let me = this;

        if (!me.nodename) {
            throw 'no node name specified';
        }

        me.callParent();

        // there is no SPICE, and thus no spiceterm, on s390x
        if (PVE.qemu.Architecture.getNodeArchitecture(me.nodename) === 's390x') {
            me.setEnableSpice(false);
        }
    },
});
