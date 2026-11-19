Ext.define('PVE.window.ExportOva', {
    extend: 'Proxmox.window.Edit',
    alias: 'widget.pveExportOvaWindow',

    title: gettext('Export as OVA'),
    submitText: gettext('Export'),
    showTaskViewer: true,
    method: 'POST',
    isCreate: true,
    width: 450,

    // The OVA includes the media loaded in the tape drives unless unchecked. Only the
    // non-default is sent.
    getValues: function () {
        let me = this;
        let values = me.callParent(arguments);
        if (!me.down('field[name=include-media]').getValue()) {
            values['include-media'] = 0;
        }
        return values;
    },

    // the media in the tape drives of the VM (s390x), e.g. ['tape0: local:import/install.aws']
    showMedia: function (conf) {
        let me = this;
        let media = Object.keys(conf)
            .filter((key) => key.match(/^tape\d+$/))
            .sort()
            .map((key) => [key, PVE.Parser.parsePropertyString(conf[key], 'file').file])
            .filter(([, file]) => file && file !== 'none')
            .map(([key, file]) => `${key}: ${file}`);
        let field = me.down('#media');
        field.setValue(
            media.length
                ? media.map((text) => Ext.htmlEncode(text)).join('<br>')
                : Ext.htmlEncode(gettext('No tape loaded')),
        );
        field.setHidden(false);
    },

    initComponent: function () {
        let me = this;

        if (!me.nodename) {
            throw 'no node name specified';
        }
        if (!me.vmid) {
            throw 'no VM ID specified';
        }

        me.url = `/nodes/${me.nodename}/qemu/${me.vmid}/export-ova`;

        me.items = [
            {
                xtype: 'displayfield',
                userCls: 'pmx-hint',
                value: gettext(
                    'The VM must be stopped. Its disks and configuration are written as OVA into the import content of the storage, from where it can be imported again.',
                ),
            },
            {
                xtype: 'pveStorageSelector',
                name: 'storage',
                fieldLabel: gettext('Storage'),
                nodename: me.nodename,
                storageContent: 'import',
                allowBlank: false,
                autoSelect: true,
            },
            {
                xtype: 'proxmoxtextfield',
                name: 'filename',
                fieldLabel: gettext('File name'),
                emptyText: me.vmname || `vm${me.vmid}`,
                regex: /^[a-zA-Z0-9\-+=_][a-zA-Z0-9\-.+=_]*$/,
                deleteEmpty: false,
                skipEmptyText: true,
            },
            {
                xtype: 'proxmoxKVComboBox',
                name: 'format',
                fieldLabel: gettext('Disk format'),
                value: 'vmdk',
                comboItems: [
                    ['vmdk', 'VMware image format (VMDK, streamOptimized)'],
                    ['qcow2', 'QEMU image format (qcow2, compressed)'],
                    ['raw', 'Raw disk image (raw)'],
                ],
            },
            {
                xtype: 'proxmoxcheckbox',
                name: 'include-media',
                fieldLabel: gettext('Include loaded tape media'),
                checked: true,
                submitValue: false, // see getValues()
            },
            {
                xtype: 'displayfield',
                itemId: 'media',
                fieldLabel: gettext('Loaded media'),
                hidden: true,
            },
            {
                xtype: 'displayfield',
                itemId: 'pendingHint',
                userCls: 'pmx-hint',
                hidden: true,
            },
        ];

        me.callParent();

        Proxmox.Utils.API2Request({
            url: `/nodes/${me.nodename}/qemu/${me.vmid}/config`,
            method: 'GET',
            failure: () => {
                // nothing to show, the export reports problems of the config itself
            },
            success: ({ result: { data } }) => {
                if (!me.isDestroyed) {
                    me.showMedia(data);
                }
            },
        });

        // the OVA has the current configuration, without the pending changes
        Proxmox.Utils.API2Request({
            url: `/nodes/${me.nodename}/qemu/${me.vmid}/pending`,
            method: 'GET',
            failure: () => {
                // the export task warns about pending changes too
            },
            success: ({ result: { data } }) => {
                if (me.isDestroyed) {
                    return;
                }
                me.showPending(data ?? []);
            },
        });
    },

    showPending: function (entries) {
        let me = this;
        let keys = entries
            .filter((entry) => entry.pending !== undefined || entry.delete)
            .map((entry) => entry.key)
            .sort();
        if (!keys.length) {
            return;
        }
        let field = me.down('#pendingHint');
        field.setValue(
            Ext.htmlEncode(
                Ext.String.format(
                    gettext(
                        'Pending changes are not part of the OVA, it gets the current configuration. Pending: {0} (applied at the next start of the VM).',
                    ),
                    keys.join(', '),
                ),
            ),
        );
        field.setHidden(false);
    },
});
