// The console panel of an s390x VM. These have no VGA display; qemu-server attaches SCLP and 3270
// consoles to them depending on the OS type, and the configured 3270 terminals. Each console gets
// a tab with xterm.js, connected while the tab is shown: a hidden tab does not keep a session (the
// SCLP consoles take one client at a time), and showing it again reconnects.
//
// The config panel creates this panel each time its Console entry is selected (and destroys it
// when another one is), so the panel loads the consoles of the VM itself.
Ext.define('PVE.qemu.S390xConsole', {
    extend: 'Ext.tab.Panel',
    alias: 'widget.pveQemuS390xConsole',

    nodename: undefined,
    vmid: undefined,

    border: false,
    // render all tabs right away, so a tab can always load its console when it gets shown
    deferredRender: false,

    initComponent: function () {
        let me = this;

        if (!me.nodename) {
            throw 'no node name specified';
        }
        if (!me.vmid) {
            throw 'no VM ID specified';
        }

        me.items = [];

        me.callParent();

        me.on('tabchange', (_panel, newTab, oldTab) => {
            me.unloadConsole(oldTab);
            me.loadConsole(newTab);
        });
        me.on('afterrender', () => me.loadConsole(me.getActiveTab()), me, { single: true });

        // changing the OS type or the terminals needs a restart of the VM anyway
        Proxmox.Utils.API2Request({
            url: `/nodes/${me.nodename}/qemu/${me.vmid}/config`,
            waitMsgTarget: me,
            failure: function (response) {
                if (!me.destroyed) {
                    me.add({ title: gettext('Error'), padding: 10, html: response.htmlStatus });
                }
            },
            success: function ({ result: { data } }) {
                if (!me.destroyed) {
                    me.setConsoles(PVE.qemu.Architecture.getS390xConsoles(data));
                }
            },
        });
    },

    // consoles: [{ serial: <serial terminal interface>, text: <tab title> }], see
    // PVE.qemu.Architecture.getS390xConsoles
    setConsoles: function (consoles) {
        let me = this;

        me.removeAll();
        me.add(
            consoles.map(({ serial, text }) => ({
                title: text,
                serial,
                layout: 'fit',
                border: false,
                items: [{ xtype: 'uxiframe', itemId: 'frame' }],
            })),
        );
        // adding the first tab activates it, but only once the tab panel is rendered
        if (!me.getActiveTab()) {
            me.setActiveTab(0);
        }
        me.loadConsole(me.getActiveTab());
    },

    consoleUrl: function (serial) {
        let me = this;

        let query = {
            console: 'kvm',
            xtermjs: 1,
            vmid: me.vmid,
            node: me.nodename,
            serial,
            resize: Ext.state.Manager.getProvider().get('novnc-scaling', 'scale'),
        };
        return '/?' + Ext.Object.toQueryString(query);
    },

    // connect the console of a tab, if it is shown and not connected yet
    loadConsole: function (tab) {
        let me = this;

        if (!tab?.serial || tab !== me.getActiveTab() || tab.consoleLoaded) {
            return;
        }
        if (!tab.rendered) {
            tab.on('afterrender', () => me.loadConsole(tab), me, { single: true });
            return;
        }
        let frame = tab.down('#frame');
        tab.consoleLoaded = true;
        frame.load(me.consoleUrl(tab.serial));
        frame.focus();
    },

    unloadConsole: function (tab) {
        if (!tab?.consoleLoaded) {
            return;
        }
        tab.consoleLoaded = false;
        tab.down('#frame').load('about:blank');
    },

    // reconnect the shown console, used when the VM was (re)started
    reload: function () {
        let me = this;

        let tab = me.getActiveTab();
        if (tab?.consoleLoaded) {
            tab.down('#frame').getWin().location.reload();
        } else {
            me.loadConsole(tab);
        }
    },
});
