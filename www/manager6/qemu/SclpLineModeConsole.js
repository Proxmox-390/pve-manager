// The SCLP line-mode console of an s390x VM, as the hardcopy it is on a real machine (the
// "Operating System Messages" of the HMC): every message of the guest since the VM was started,
// with a marker line for every IPL, read from the log qemu-server keeps on the host (sclp-log),
// and an input line for operator commands (sclp-command). Neither needs this view: the log is
// written and commands are accepted whether or not it is open.
//
// The log is kept in files: the current one and older generations (rotated at 64 MiB and at every
// start of the VM, all files of a VM within 512 MiB). The file selector shows an older one; Save
// downloads the file shown, or the whole history (all files, oldest first, as one text file).
// Clear only hides the lines shown so far in this browser, the log on the host stays complete.
// The view follows new lines, unless it was scrolled up.
Ext.define('PVE.qemu.SclpLineModeConsole', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveQemuSclpLineModeConsole',

    isSclpLineModeConsole: true,

    nodename: undefined,
    vmid: undefined,

    // how often to look for new lines while shown, in ms
    pollInterval: 2000,
    // bytes per request for the initial load and Save
    chunkSize: 4 * 1024 * 1024,

    layout: 'fit',
    border: false,

    // view state: the log being shown (id), the byte offset after the text shown (end), the offset
    // the view starts at (start, after Clear), the text shown and the search matches
    logId: undefined,
    // the file shown: 0 is the current one, n the generation <log>.n
    generation: 0,
    files: [],
    logEnd: 0,
    viewStart: 0,
    text: '',
    follow: true,
    matches: [],
    currentMatch: -1,

    initComponent: function () {
        let me = this;

        if (!me.nodename) {
            throw 'no node name specified';
        }
        if (!me.vmid) {
            throw 'no VM ID specified';
        }
        me.history = [];
        me.historyPos = 0;

        me.items = [
            {
                xtype: 'component',
                itemId: 'paper',
                cls: 'pve-sclplm-paper',
                scrollable: true,
                html: '<pre class="pve-sclplm-text"></pre>',
                listeners: {
                    afterrender: function (cmp) {
                        cmp.getEl().on('scroll', () => me.onPaperScroll());
                    },
                },
            },
        ];

        // narrow panels (a 1024 px window): what does not fit goes to an overflow menu
        me.tbar = {
            overflowHandler: 'menu',
            items: me.toolbarItems(),
        };

        // The command bar: with some room below the field and the button, so that their lower
        // border stays visible where the panel meets the splitter of the task log (cut
        // by a few pixels on a node, browser zoom).
        me.bbar = {
            itemId: 'commandBar',
            padding: '6 8 9 8',
            items: me.commandBarItems(),
        };

        me.callParent();

        me.on('destroy', () => me.disconnect());
        // lay out again once the web fonts are there, in case the bar was measured before
        if (document.fonts?.ready) {
            document.fonts.ready.then(() => {
                if (!me.destroyed && me.rendered) {
                    me.updateLayout();
                }
            });
        }
    },

    toolbarItems: function () {
        let me = this;
        return [
            {
                xtype: 'combobox',
                itemId: 'fileSel',
                width: 200,
                matchFieldWidth: false,
                listConfig: { minWidth: 200 },
                editable: false,
                queryMode: 'local',
                displayField: 'text',
                valueField: 'generation',
                value: 0,
                store: {
                    fields: ['generation', 'text'],
                    data: [{ generation: 0, text: gettext('Current log') }],
                },
                listeners: {
                    select: (_cb, rec) => me.selectGeneration(rec.get('generation')),
                },
            },
            {
                text: gettext('Clear'),
                iconCls: 'fa fa-eraser',
                tooltip: gettext('Hide the lines shown so far. The log on the host is kept.'),
                handler: () => me.clearView(),
            },
            {
                itemId: 'showAll',
                text: gettext('Show all'),
                iconCls: 'fa fa-undo',
                tooltip: gettext('Show the whole log again'),
                disabled: true,
                handler: () => me.showAll(),
            },
            {
                text: gettext('Save'),
                itemId: 'save',
                iconCls: 'fa fa-download',
                menu: [
                    {
                        text: gettext('File shown'),
                        itemId: 'saveFile',
                        iconCls: 'fa fa-file-text-o',
                        handler: () => me.saveLog([me.generation]),
                    },
                    {
                        text: gettext('Whole history (all files, oldest first)'),
                        itemId: 'saveAll',
                        iconCls: 'fa fa-files-o',
                        handler: () =>
                            me.saveLog(
                                me.files.map((f) => f.generation).sort((a, b) => b - a),
                                'all',
                            ),
                    },
                ],
            },
            '-',
            {
                xtype: 'textfield',
                itemId: 'search',
                emptyText: gettext('Search'),
                width: 160,
                enableKeyEvents: true,
                listeners: {
                    change: {
                        fn: () => me.updateSearch(),
                        buffer: 300,
                    },
                    specialkey: function (field, e) {
                        if (e.getKey() === e.ENTER) {
                            me.gotoMatch(e.shiftKey ? -1 : 1);
                        } else if (e.getKey() === e.ESC) {
                            field.setValue('');
                        }
                    },
                },
            },
            {
                iconCls: 'fa fa-chevron-up',
                tooltip: gettext('Previous match'),
                overflowText: gettext('Previous match'),
                handler: () => me.gotoMatch(-1),
            },
            {
                iconCls: 'fa fa-chevron-down',
                tooltip: gettext('Next match'),
                overflowText: gettext('Next match'),
                handler: () => me.gotoMatch(1),
            },
            {
                xtype: 'tbtext',
                itemId: 'matchInfo',
                text: '',
            },
            '->',
            {
                xtype: 'tbtext',
                itemId: 'status',
                text: '',
            },
            {
                itemId: 'scrollEnd',
                text: gettext('Scroll to end'),
                iconCls: 'fa fa-angle-double-down',
                tooltip: gettext('Follow new lines again'),
                // disabled, not hidden: a layout would restore the scroll position of the view
                disabled: true,
                handler: () => me.scrollToEnd(),
            },
        ];
    },

    commandBarItems: function () {
        let me = this;
        return [
            {
                xtype: 'textfield',
                itemId: 'command',
                flex: 1,
                emptyText: gettext('Operator command (Enter sends it, Up/Down: history)'),
                maxLength: 251,
                enforceMaxLength: true,
                enableKeyEvents: true,
                listeners: {
                    specialkey: function (field, e) {
                        let key = e.getKey();
                        if (key === e.ENTER) {
                            e.stopEvent();
                            me.sendCommand();
                        } else if (key === e.UP || key === e.DOWN) {
                            e.stopEvent();
                            me.browseHistory(key === e.UP ? -1 : 1);
                        }
                    },
                },
            },
            {
                text: gettext('Send'),
                iconCls: 'fa fa-paper-plane',
                handler: () => me.sendCommand(),
            },
        ];
    },

    storageKey: function () {
        let me = this;
        return `pve-sclplm-view-${me.nodename}-${me.vmid}`;
    },

    // the offset Clear left the view at, remembered per log in this browser
    loadViewStart: function (logId) {
        let me = this;
        try {
            let saved = JSON.parse(window.localStorage.getItem(me.storageKey()) ?? 'null');
            if (saved && saved.id === logId && Number.isInteger(saved.start)) {
                return saved.start;
            }
        } catch (_e) {
            // no storage, start at the beginning
        }
        return 0;
    },

    saveViewStart: function () {
        let me = this;
        try {
            if (me.viewStart > 0) {
                window.localStorage.setItem(
                    me.storageKey(),
                    JSON.stringify({ id: me.logId, start: me.viewStart }),
                );
            } else {
                window.localStorage.removeItem(me.storageKey());
            }
        } catch (_e) {
            // the view starts at the beginning next time
        }
    },

    logUrl: function () {
        let me = this;
        return `/nodes/${me.nodename}/qemu/${me.vmid}/sclp-log`;
    },

    // start showing the log, called when the tab gets shown
    connect: function () {
        let me = this;

        if (me.connected) {
            return;
        }
        me.connected = true;
        me.poll();
        me.down('#command').focus();
    },

    // stop polling, called when the tab gets hidden
    disconnect: function () {
        let me = this;

        me.connected = false;
        // a response still on its way is for the previous view
        me.pollSeq = (me.pollSeq ?? 0) + 1;
        if (me.pollTimer) {
            clearTimeout(me.pollTimer);
            me.pollTimer = undefined;
        }
    },

    // the VM was (re)started: look right away, a new log replaces the old one
    reconnect: function () {
        let me = this;

        me.disconnect();
        me.connect();
    },

    schedulePoll: function (delay) {
        let me = this;

        if (me.pollTimer) {
            clearTimeout(me.pollTimer);
        }
        me.pollTimer = setTimeout(() => {
            me.pollTimer = undefined;
            me.poll();
        }, delay ?? me.pollInterval);
    },

    poll: function () {
        let me = this;

        if (!me.connected || me.destroyed || me.polling) {
            return;
        }
        me.polling = true;
        let seq = me.pollSeq;
        // a response for a previous view (another file, or the tab was hidden): poll again
        let stale = function () {
            if (seq === me.pollSeq) {
                return false;
            }
            if (me.connected) {
                me.schedulePoll(0);
            }
            return true;
        };
        Proxmox.Utils.API2Request({
            url: me.logUrl(),
            method: 'GET',
            params: { start: me.logEnd, limit: me.chunkSize, generation: me.generation },
            failure: function (response) {
                me.polling = false;
                if (me.destroyed || stale()) {
                    return;
                }
                me.setStatus(response.htmlStatus ?? gettext('Error'), true);
                me.schedulePoll(me.pollInterval * 2);
            },
            success: function ({ result: { data } }) {
                me.polling = false;
                if (me.destroyed || stale()) {
                    return;
                }
                me.setStatus('');
                me.updateFiles(data.files ?? []);
                if (data.id !== me.logId) {
                    // a new log (the VM was started again): begin anew
                    me.logId = data.id;
                    me.viewStart = me.loadViewStart(data.id);
                    me.logEnd = me.viewStart;
                    me.text = '';
                    me.down('#showAll').setDisabled(me.viewStart === 0);
                    me.renderText();
                    me.schedulePoll(0);
                    return;
                }
                if (data.data.length) {
                    me.logEnd = data.end;
                    me.appendText(data.data);
                }
                // more than one chunk to load: go on right away
                me.schedulePoll(data.complete ? undefined : 0);
            },
        });
    },

    setStatus: function (html, isError) {
        let me = this;
        let status = me.down('#status');
        status.setText(isError ? `<span class="pve-sclplm-error">${html}</span>` : html);
    },

    paperEl: function () {
        let me = this;
        return me.down('#paper').getEl();
    },

    textEl: function () {
        let me = this;
        return me.paperEl()?.down('pre.pve-sclplm-text', true);
    },

    appendText: function (text) {
        let me = this;

        me.text += text;
        if (me.searchRegex()) {
            me.renderText(); // the matches have to be marked
            return;
        }
        let pre = me.textEl();
        if (pre) {
            pre.appendChild(document.createTextNode(text));
            me.afterTextChange();
        }
    },

    searchRegex: function () {
        let me = this;
        let value = me.down('#search').getValue();
        if (!value) {
            return undefined;
        }
        return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    },

    // (re)build the shown text, with the search matches marked
    renderText: function () {
        let me = this;

        let pre = me.textEl();
        if (!pre) {
            me.on('afterrender', () => me.renderText(), me, { single: true });
            return;
        }
        let regex = me.searchRegex();
        if (!regex) {
            pre.textContent = me.text;
            me.matches = [];
            me.currentMatch = -1;
            me.updateMatchInfo();
            me.afterTextChange();
            return;
        }
        let html = '';
        let last = 0;
        let count = 0;
        for (const match of me.text.matchAll(regex)) {
            html += Ext.htmlEncode(me.text.slice(last, match.index));
            html += `<mark class="pve-sclplm-match">${Ext.htmlEncode(match[0])}</mark>`;
            last = match.index + match[0].length;
            count++;
        }
        html += Ext.htmlEncode(me.text.slice(last));
        pre.innerHTML = html;
        me.matches = Array.from(pre.querySelectorAll('mark.pve-sclplm-match'));
        if (me.currentMatch >= count) {
            me.currentMatch = count - 1;
        }
        me.markCurrent();
        me.updateMatchInfo();
        me.afterTextChange();
    },

    afterTextChange: function () {
        let me = this;
        if (me.follow) {
            me.scrollToEnd();
        }
    },

    scrollToEnd: function () {
        let me = this;

        let paper = me.down('#paper');
        if (!paper.rendered) {
            return;
        }
        me.follow = true;
        me.down('#scrollEnd').setDisabled(true);
        paper.getScrollable().scrollTo(null, Infinity);
    },

    // follow new lines while the view is at its end, pause when it was scrolled up
    onPaperScroll: function () {
        let me = this;

        let el = me.paperEl().dom;
        me.follow = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
        me.down('#scrollEnd').setDisabled(me.follow);
    },

    updateSearch: function () {
        let me = this;

        me.currentMatch = -1;
        me.renderText();
        if (me.matches.length) {
            me.gotoMatch(1);
        }
    },

    gotoMatch: function (step) {
        let me = this;

        let count = me.matches.length;
        if (!count) {
            return;
        }
        if (me.currentMatch < 0) {
            me.currentMatch = step > 0 ? 0 : count - 1;
        } else {
            me.currentMatch = (me.currentMatch + step + count) % count;
        }
        me.markCurrent();
        me.updateMatchInfo();
        let mark = me.matches[me.currentMatch];
        mark.scrollIntoView({ block: 'center' });
        me.onPaperScroll();
    },

    markCurrent: function () {
        let me = this;
        me.matches.forEach((mark, i) =>
            mark.classList.toggle('pve-sclplm-current', i === me.currentMatch),
        );
    },

    updateMatchInfo: function () {
        let me = this;

        let info = me.down('#matchInfo');
        if (!me.down('#search').getValue()) {
            info.setText('');
        } else if (!me.matches.length) {
            info.setText(gettext('No match'));
        } else {
            let current = me.currentMatch >= 0 ? me.currentMatch + 1 : '-';
            info.setText(`${current} / ${me.matches.length}`);
        }
    },

    clearView: function () {
        let me = this;

        me.viewStart = me.logEnd;
        me.text = '';
        me.saveViewStart();
        me.down('#showAll').setDisabled(me.viewStart === 0);
        me.renderText();
    },

    showAll: function () {
        let me = this;

        me.viewStart = 0;
        me.saveViewStart();
        me.down('#showAll').setDisabled(true);
        // load the log again from its beginning
        me.logId = undefined;
        me.logEnd = 0;
        me.text = '';
        me.renderText();
        me.reconnect();
    },

    // the files of the log, for the file selector: the current one and the older generations
    updateFiles: function (files) {
        let me = this;

        let key = JSON.stringify(files.map((f) => [f.generation, f.size, f.mtime]));
        if (key === me.filesKey) {
            return;
        }
        me.filesKey = key;
        me.files = files;
        let items = files.map((f) => {
            let size = Proxmox.Utils.format_size(f.size);
            if (!f.generation) {
                return { generation: 0, text: `${gettext('Current log')} (${size})` };
            }
            let date = Ext.Date.format(new Date(f.mtime * 1000), 'Y-m-d H:i');
            return { generation: f.generation, text: `${f.name} (${size}, ${date})` };
        });
        if (!items.length) {
            items = [{ generation: 0, text: gettext('Current log') }];
        }
        let combo = me.down('#fileSel');
        combo.getStore().setData(items);
        if (!items.some((i) => i.generation === me.generation)) {
            // the file shown was removed (the oldest generations go)
            me.selectGeneration(0);
        }
        combo.setValue(me.generation);
    },

    selectGeneration: function (generation) {
        let me = this;

        if (generation === me.generation && me.logId !== undefined) {
            return;
        }
        me.generation = generation;
        me.down('#fileSel').setValue(generation);
        me.logId = undefined;
        me.logEnd = 0;
        me.text = '';
        me.renderText();
        me.reconnect();
    },

    // download log files as one text file, read in chunks; generations in the order given
    saveLog: function (generations, suffix) {
        let me = this;

        let parts = [];
        let fetchChunk = function (index, start) {
            if (index >= generations.length) {
                let blob = new Blob(parts, { type: 'text/plain;charset=utf-8' });
                let stamp = Ext.Date.format(new Date(), 'Ymd-His');
                let name = `vm${me.vmid}-sclp-line-mode-${stamp}`;
                if (suffix) {
                    name += `-${suffix}`;
                } else if (generations[0]) {
                    name += `.${generations[0]}`;
                }
                let link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = `${name}.txt`;
                document.body.appendChild(link);
                link.click();
                link.remove();
                setTimeout(() => URL.revokeObjectURL(link.href), 10000);
                return;
            }
            Proxmox.Utils.API2Request({
                url: me.logUrl(),
                method: 'GET',
                params: { start, limit: me.chunkSize, generation: generations[index] },
                waitMsgTarget: me,
                failure: (response) => Ext.Msg.alert(gettext('Error'), response.htmlStatus),
                success: function ({ result: { data } }) {
                    parts.push(data.data);
                    if (!data.complete && data.end > start) {
                        fetchChunk(index, data.end);
                    } else {
                        fetchChunk(index + 1, 0);
                    }
                },
            });
        };
        fetchChunk(0, 0);
    },

    browseHistory: function (step) {
        let me = this;

        let field = me.down('#command');
        if (!me.history.length) {
            return;
        }
        me.historyPos = Math.min(Math.max(me.historyPos + step, 0), me.history.length);
        field.setValue(me.history[me.historyPos] ?? '');
    },

    sendCommand: function () {
        let me = this;

        let field = me.down('#command');
        let command = field.getValue();
        if (!command || !command.trim()) {
            return;
        }
        field.setDisabled(true);
        Proxmox.Utils.API2Request({
            url: `/nodes/${me.nodename}/qemu/${me.vmid}/sclp-command`,
            method: 'POST',
            params: { command },
            failure: function (response) {
                if (me.destroyed) {
                    return;
                }
                field.setDisabled(false);
                Ext.Msg.alert(gettext('Error'), response.htmlStatus);
            },
            success: function () {
                if (me.destroyed) {
                    return;
                }
                if (me.history[me.history.length - 1] !== command) {
                    me.history.push(command);
                }
                me.historyPos = me.history.length;
                field.setValue('');
                field.setDisabled(false);
                field.focus();
                // the guest answers in the log, follow it
                me.scrollToEnd();
                me.schedulePoll(300);
            },
        });
    },
});
