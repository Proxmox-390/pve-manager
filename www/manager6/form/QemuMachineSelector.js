Ext.define('PVE.form.QemuMachineSelector', {
    extend: 'PVE.form.FilteredKVComboBox',
    alias: 'widget.pveQemuMachineSelector',

    comboItems: [
        ['__default__', PVE.Utils.render_qemu_machine('')],
        ['q35', 'q35'],
    ],

    allowedValuesPerCategory: PVE.qemu.Architecture.allowedMachines,

    setDefaultDisplay: (arch) => PVE.Utils.render_qemu_machine('', arch),

    // the node whose QEMU build offers the s390x machine types
    nodename: undefined,

    // s390x: select the machine type new VMs get, instead of keeping the current value
    selectNewVmDefault: false,

    setValue: function (value) {
        let me = this;
        if (me.category === 's390x' && !me.s390xItems) {
            me.pendingValue = value; // the items are not loaded yet
        }
        return me.callParent(arguments);
    },

    setNodename: function (nodename) {
        let me = this;
        me.nodename = nodename;
        if (me.category === 's390x') {
            me.loadS390xMachines();
        }
    },

    setCategory: function (category) {
        let me = this;
        if (category === 's390x') {
            me.category = category;
            me.loadS390xMachines();
            return;
        }
        if (me.s390xItems) {
            me.store.setData(me.comboItems.map(([key, value]) => ({ key, value })));
            delete me.s390xItems;
        }
        me.callParent([category]);
    },

    // On s390x, the virtio machine and the mainframe machine types of the QEMU build, as the
    // machine type API lists them, always with an explicit value: new VMs without one get a
    // mainframe machine, existing VMs without one have the virtio machine.
    loadS390xMachines: function () {
        let me = this;
        let nodename = me.nodename;
        PVE.qemu.Architecture.loadS390xMachines(nodename, function (list) {
            if (me.isDestroyed || me.category !== 's390x' || me.nodename !== nodename) {
                return;
            }
            let virtio = PVE.qemu.Architecture.defaultMachines.s390x;
            let items = [{ key: virtio, value: `virtio (${virtio})` }];
            PVE.qemu.Architecture.getS390xMainframeChoices(list).forEach((m) =>
                items.push({ key: m.id, value: m.text }),
            );
            me.s390xItems = items;
            me.store.clearFilter();
            me.store.setData(items);

            let value = me.pendingValue ?? me.getValue();
            delete me.pendingValue;
            if (me.selectNewVmDefault) {
                value = PVE.qemu.Architecture.getS390xNewVmMachine(list);
            } else if (!value || value === '__default__') {
                value = virtio;
            }
            if (!items.find((item) => item.key === value)) {
                // keep a configured value visible: a pinned version, a deprecated machine type, or
                // an unknown one, which the backend refuses at start
                let entry = list.find((m) => m.id === value && m.class === 'mainframe');
                let text = entry
                    ? PVE.qemu.Architecture.renderS390xMachine(
                          PVE.qemu.Architecture.parseS390xMachine(entry),
                      )
                    : value;
                me.store.add({ key: value, value: text });
            }
            me.setValue(value);
            me.fireEvent('s390xmachinesloaded', me, list);
        });
    },
});
