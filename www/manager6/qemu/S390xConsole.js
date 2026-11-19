// The console panel of an s390x VM. These have no VGA display; qemu-server attaches SCLP and 3270
// consoles to them depending on the OS type, and the configured 3270 terminals. Each console gets
// a tab with xterm.js, connected while the tab is shown: a hidden tab does not keep a session (the
// SCLP consoles take one client at a time), and showing it again reconnects. Nothing is lost when
// a tab or the panel is left (the 3270 sessions persist on the host, the SCLP consoles stay with
// the VM), so xterm.js must not ask whether to leave its page then.
//
// The SCLP line-mode console is no terminal but a hardcopy (PVE.qemu.SclpLineModeConsole): the
// log of the console kept on the host, and an input line for commands.
//
// The config panel creates this panel each time its Console entry is selected (and destroys it
// when another one is), so the panel loads the consoles of the VM itself.
//
// While the VM is not running, the terminal tabs show that, with a button to start it, instead of
// an empty terminal; the line-mode console keeps showing its log.
Ext.define('PVE.qemu.S390xConsole', {
    extend: 'Ext.tab.Panel',
    alias: 'widget.pveQemuS390xConsole',

    nodename: undefined,
    vmid: undefined,
    // the status/current store of the VM (the config panel's), else the panel polls its own
    statusStore: undefined,
    vmRunning: undefined, // unknown until the status is loaded

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

        if (!me.statusStore) {
            me.statusStore = Ext.create('Proxmox.data.ObjectStore', {
                url: `/api2/json/nodes/${me.nodename}/qemu/${me.vmid}/status/current`,
                interval: 3000,
            });
            me.statusStore.startUpdate();
            me.on('destroy', () => me.statusStore.stopUpdate());
        }
        me.mon(me.statusStore, 'load', () => me.updateRunning());
        me.updateRunning();

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

    // consoles: [{ serial: <serial terminal interface>, text: <tab title>, model: <3270 model> }],
    // see PVE.qemu.Architecture.getS390xConsoles
    setConsoles: function (consoles) {
        let me = this;

        me.removeAll();
        me.add(
            consoles.map(({ serial, text, model }) =>
                serial === 'sclplm'
                    ? {
                          // a hardcopy view of the log, not a terminal
                          xtype: 'pveQemuSclpLineModeConsole',
                          title: text,
                          serial,
                          nodename: me.nodename,
                          vmid: me.vmid,
                      }
                    : {
                          title: text,
                          serial,
                          model3270: model,
                          layout: 'card',
                          border: false,
                          items: [{ xtype: 'uxiframe', itemId: 'frame' }, me.stoppedItem()],
                      },
            ),
        );
        // adding the first tab activates it, but only once the tab panel is rendered
        if (!me.getActiveTab()) {
            me.setActiveTab(0);
        }
        me.loadConsole(me.getActiveTab());
    },

    // shown in a terminal tab while the VM is not running
    stoppedItem: function () {
        let me = this;
        let caps = Ext.state.Manager.get('GuiCap');
        return {
            itemId: 'stopped',
            xtype: 'container',
            layout: {
                type: 'vbox',
                align: 'center',
                pack: 'center',
            },
            items: [
                {
                    xtype: 'component',
                    padding: 10,
                    style: { fontSize: '14px' },
                    html: Ext.htmlEncode(
                        Ext.String.format(gettext('VM {0} is not running'), me.vmid),
                    ),
                },
                {
                    xtype: 'button',
                    text: gettext('Start Now'),
                    iconCls: 'fa fa-play',
                    hidden: !caps?.vms['VM.PowerMgmt'],
                    handler: function (button) {
                        button.disable();
                        Proxmox.Utils.API2Request({
                            url: `/nodes/${me.nodename}/qemu/${me.vmid}/status/start`,
                            method: 'POST',
                            failure: function (response) {
                                button.enable();
                                Ext.Msg.alert(gettext('Error'), response.htmlStatus);
                            },
                            success: () => button.enable(),
                        });
                    },
                },
            ],
        };
    },

    // follow the status of the VM: connect the terminal tab shown when it runs, else show that
    // it does not
    updateRunning: function () {
        let me = this;
        let status = me.statusStore.getById('status')?.data.value;
        if (status === undefined) {
            return; // not loaded yet
        }
        let running = status === 'running';
        if (running === me.vmRunning) {
            return;
        }
        me.vmRunning = running;
        let tab = me.getActiveTab();
        if (!running) {
            me.unloadConsole(tab);
            me.items.each((item) => item.down('#stopped') && item.getLayout().setActiveItem(1));
        } else {
            me.items.each((item) => item.down('#stopped') && item.getLayout().setActiveItem(0));
            me.loadConsole(tab);
        }
    },

    consoleUrl: function (serial, model) {
        let me = this;

        let query = {
            console: 'kvm',
            xtermjs: 1,
            vmid: me.vmid,
            node: me.nodename,
            serial,
            resize: Ext.state.Manager.getProvider().get('novnc-scaling', 'scale'),
            'unload-prompt': 0,
        };
        if (model) {
            // xterm.js shows the 3270 session at its fixed size, centred or with scroll bars
            query.model = model;
        }
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
        if (tab.isSclpLineModeConsole) {
            tab.consoleLoaded = true;
            tab.connect();
            return;
        }
        if (!me.vmRunning) {
            // the status tells when to connect
            tab.getLayout().setActiveItem(me.vmRunning === false ? 1 : 0);
            return;
        }
        tab.consoleLoaded = true;
        tab.getLayout().setActiveItem(0);
        let frame = tab.down('#frame');
        frame.load(me.consoleUrl(tab.serial, tab.model3270));
        frame.focus();
    },

    unloadConsole: function (tab) {
        if (!tab?.consoleLoaded) {
            return;
        }
        tab.consoleLoaded = false;
        if (tab.isSclpLineModeConsole) {
            tab.disconnect();
            return;
        }
        tab.down('#frame').load('about:blank');
    },

    // reconnect the shown console, used when the VM was (re)started
    reload: function () {
        let me = this;

        let tab = me.getActiveTab();
        if (tab?.isSclpLineModeConsole && tab.consoleLoaded) {
            tab.reconnect();
        } else if (tab?.consoleLoaded) {
            tab.down('#frame').getWin().location.reload();
        } else {
            me.loadConsole(tab);
        }
    },
});
