Ext.define('PVE.form.BusTypeSelector', {
    extend: 'PVE.form.FilteredKVComboBox',
    alias: 'widget.pveBusSelector',

    withVirtIO: true,
    withUnused: false,

    allowedValuesPerCategory: PVE.qemu.Architecture.allowedBusses,

    initComponent: function () {
        var me = this;

        me.comboItems = [
            ['ide', 'IDE'],
            ['sata', 'SATA'],
        ];

        if (me.withVirtIO) {
            me.comboItems.push(['virtio', 'VirtIO Block']);
        }

        me.comboItems.push(['scsi', 'SCSI']);

        // s390x only, see PVE.qemu.Architecture.allowedBusses
        me.comboItems.push(['fba', gettext('FBA DASD')]);
        me.comboItems.push(['ckd', gettext('CKD DASD')]); // 3390 volumes, see the type

        if (me.withUnused) {
            me.comboItems.push(['unused', 'Unused']);
        }

        me.callParent();
    },
});
