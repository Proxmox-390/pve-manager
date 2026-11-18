// The console panel of an s390x VM. These have no VGA display; qemu-server attaches SCLP and 3270
// consoles to them depending on the OS type, which are opened in xterm.js, one tab per console.
Ext.define('PVE.qemu.S390xConsole', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveQemuS390xConsole',

    nodename: undefined,
    vmid: undefined,

    layout: 'fit',
    border: false,

    listeners: {
        activate: function () {
            this.loadActiveConsole();
        },
    },

    // consoles: [{ serial: <serial terminal interface>, text: <tab title> }], see
    // PVE.qemu.Architecture.getS390xConsoles
    setConsoles: function (consoles) {
        let me = this;

        me.removeAll();
        me.add({
            xtype: 'tabpanel',
            border: false,
            // no tabs for a single console
            tabBar: { hidden: consoles.length < 2 },
            items: consoles.map(({ serial, text }) => ({
                xtype: 'pveNoVncConsole',
                title: text,
                consoleType: 'kvm',
                xtermjs: true,
                serial,
                vmid: me.vmid,
                nodename: me.nodename,
            })),
        });

        // the consoles arrive after the config is loaded, the panel may already be shown
        if (me.isVisible(true)) {
            me.loadActiveConsole();
        }
    },

    // A console loads (and reconnects) when it gets the 'activate' event. The tab panel only
    // fires it when switching tabs, not for the initially active tab, and not when this panel
    // gets shown, so pass this panel's activation on to the active console.
    loadActiveConsole: function () {
        let me = this;

        let activeConsole = me.down('tabpanel')?.getActiveTab();
        if (!activeConsole) {
            return;
        }
        if (!activeConsole.rendered) {
            if (!activeConsole.loadOnRender) {
                activeConsole.loadOnRender = true;
                activeConsole.on('afterrender', () => me.loadActiveConsole(), me, { single: true });
            }
            return;
        }
        activeConsole.fireEvent('activate', activeConsole);
    },

    // reconnect the active console, used when the VM was (re)started
    reload: function () {
        let me = this;

        let activeConsole = me.down('tabpanel')?.getActiveTab();
        if (activeConsole?.down('[itemid=vncconsole]')?.src) {
            activeConsole.reload();
        } else if (me.isVisible(true)) {
            me.loadActiveConsole(); // not loaded yet
        }
    },
});
