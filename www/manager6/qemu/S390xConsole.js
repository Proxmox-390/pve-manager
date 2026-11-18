// The console panel of an s390x VM. These have no VGA display; qemu-server attaches SCLP and 3270
// consoles to them depending on the OS type, which are opened in xterm.js, one tab per console.
Ext.define('PVE.qemu.S390xConsole', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveQemuS390xConsole',

    nodename: undefined,
    vmid: undefined,

    layout: 'fit',
    border: false,

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
    },

    reload: function () {
        let activeConsole = this.down('tabpanel')?.getActiveTab();
        if (activeConsole?.rendered) {
            activeConsole.reload();
        }
    },
});
