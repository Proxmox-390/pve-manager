Ext.define('PVE.form.NetworkCardSelector', {
    extend: 'Proxmox.form.KVComboBox',
    alias: 'widget.pveNetworkCardSelector',
    comboItems: [
        ['e1000', 'Intel E1000'],
        ['e1000e', 'Intel E1000E'],
        ['virtio', 'VirtIO (' + gettext('paravirtualized') + ')'],
        ['rtl8139', 'Realtek RTL8139'],
        ['vmxnet3', 'VMware vmxnet3'],
    ],

    // On s390x, there are qeth adapters (OSA-Express) for all operating systems and VirtIO for
    // Linux guests only. 'configured' is the model of an existing NIC, which is kept selectable.
    setArchitecture: function (arch, ostype, configured) {
        let me = this;

        let items =
            me.initialConfig.comboItems ?? PVE.form.NetworkCardSelector.prototype.comboItems;
        if (arch === 's390x') {
            items = [['qeth', 'qeth (OSA-Express)']];
            if (PVE.qemu.Architecture.isS390xLinux(ostype)) {
                items.push(['virtio', 'VirtIO (' + gettext('paravirtualized') + ')']);
            }
            if (configured && !items.find(([key]) => key === configured)) {
                items.push([configured, configured]);
            }
        }
        let value = me.getValue();
        me.getStore().setData(items.map(([key, text]) => ({ key, value: text })));
        if (!items.find(([key]) => key === value)) {
            me.setValue(items[0][0]);
        }
    },
});
