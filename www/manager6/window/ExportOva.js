Ext.define('PVE.window.ExportOva', {
    extend: 'Proxmox.window.Edit',
    alias: 'widget.pveExportOvaWindow',

    title: gettext('Export as OVA'),
    submitText: gettext('Export'),
    showTaskViewer: true,
    method: 'POST',
    isCreate: true,
    width: 450,

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
        ];

        me.callParent();
    },
});
