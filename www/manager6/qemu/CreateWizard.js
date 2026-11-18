Ext.define('PVE.qemu.CreateWizard', {
    extend: 'PVE.window.Wizard',
    alias: 'widget.pveQemuCreateWizard',
    mixins: ['Proxmox.Mixin.CBind'],

    viewModel: {
        data: {
            nodename: '',
            current: {
                scsihw: '',
                architecture: '',
            },
        },
        formulas: {
            cgroupMode: function (get) {
                const nodeInfo = PVE.data.ResourceStore.getNodes().find(
                    (node) => node.node === get('nodename'),
                );
                return nodeInfo ? nodeInfo['cgroup-mode'] : 2;
            },
        },
    },

    cbindData: {
        nodename: undefined,
    },

    subject: gettext('Virtual Machine'),

    // fot the special case that we have 2 cdrom drives
    //
    // emulates part of the backend bootorder logic, but includes all cdrom drives since the backend
    // cannot know which one is a bootable iso and hardcodes the known values (ide0/2, net0)
    calculateBootOrder: function (values) {
        // user selected windows + second cdrom
        if (values.ide0 && values.ide0.match(/media=cdrom/)) {
            let disk;
            PVE.Utils.forEachBus(['ide', 'scsi', 'virtio', 'sata'], (type, id) => {
                let confId = type + id;
                if (!values[confId]) {
                    return undefined;
                }
                if (values[confId].match(/media=cdrom/)) {
                    return undefined;
                }
                disk = confId;
                return false; // abort loop
            });

            let order = [];
            if (disk) {
                order.push(disk);
            }
            order.push('ide2', 'ide0'); // ide2 is the install ISO and should be first
            if (values.net0) {
                order.push('net0');
            }

            return `order=${order.join(';')}`;
        }
        return undefined;
    },

    // s390x: the devices of the new VM it can IPL from, by key, with a short description
    getIPLDevices: function (kv) {
        let devices = [];
        let isCloudInit = (value) => /(?:^|[:/,])[^,]*cloudinit/.test(value ?? '');
        let bus = (re, what) =>
            Object.keys(kv)
                .filter((key) => re.test(key) && !isCloudInit(kv[key]))
                .sort(
                    (a, b) =>
                        parseInt(a.replace(/^\D+/, ''), 10) - parseInt(b.replace(/^\D+/, ''), 10),
                )
                .forEach((key) => {
                    let cdrom = /(?:^|,)media=cdrom(?:,|$)/.test(kv[key]);
                    devices.push({ key, cdrom, text: cdrom ? gettext('CD/DVD drive') : what });
                });
        bus(/^tape\d+$/, gettext('Tape drive'));
        bus(/^ckd\d+$/, gettext('CKD DASD'));
        bus(/^fba\d+$/, gettext('FBA DASD'));
        bus(/^virtio\d+$/, gettext('VirtIO disk'));
        bus(/^scsi\d+$/, gettext('SCSI disk'));
        Object.keys(kv)
            // VirtIO only: the firmware network boot; qeth adapters cannot IPL in QEMU
            .filter((key) => /^net\d+$/.test(key) && /^virtio\b/.test(kv[key] ?? ''))
            .sort()
            .forEach((key) => devices.push({ key, text: gettext('Network device') }));
        return devices;
    },

    // s390x: the IPL device a new VM gets unless one is chosen. Linux and the network boot use
    // the boot order (the network boot loads the installer once), mainframe operating systems IPL
    // from the install medium, else from the first disk (DASDs first).
    getDefaultIPLDevice: function (kv, devices) {
        if (kv.netboot || PVE.qemu.Architecture.isS390xLinux(kv.ostype)) {
            return undefined;
        }
        let cdrom = devices.find((device) => device.cdrom);
        let first = devices.find(({ key }) => !/^net\d+$/.test(key));
        return (kv.tape0 ? 'tape0' : undefined) ?? cdrom?.key ?? first?.key;
    },

    // s390x: update the IPL device choices of the system tab from the devices of the other tabs
    updateIPLFields: function () {
        let me = this;
        let field = me.down('field[name=ipldevice]');
        let s390x = me.getViewModel().get('current.architecture') === 's390x';
        if (!field || !s390x || me.updatingIPL) {
            return;
        }
        me.updatingIPL = true;
        let kv = me.getValues();
        let devices = me.getIPLDevices(kv);
        let def = me.getDefaultIPLDevice(kv, devices);
        let value = field.getValue();
        if (value !== '__default__' && !devices.some(({ key }) => key === value)) {
            value = '__default__';
        }
        let defaultText = def ?? gettext('boot order');
        field.setComboItems([
            ['__default__', `${Proxmox.Utils.defaultText} (${defaultText})`],
            ...devices.map(({ key, text }) => [key, `${key}: ${text}`]),
        ]);
        field.setValue(value);
        // a load parameter needs a device to IPL from
        me.down('field[name=iplloadparm]').setDisabled(value === '__default__' && !def);
        me.updatingIPL = false;
    },

    // s390x: the 'ipl' option from the IPL fields of the system tab
    calculateIPL: function (kv) {
        let me = this;
        let device = kv.ipldevice; // not submitted for the default
        let loadparm = kv.iplloadparm;
        delete kv.ipldevice;
        delete kv.iplloadparm;
        if (me.getViewModel().get('current.architecture') !== 's390x') {
            return;
        }
        let devices = me.getIPLDevices(kv);
        if (!devices.some(({ key }) => key === device)) {
            device = me.getDefaultIPLDevice(kv, devices);
        }
        if (device) {
            let ipl = { device };
            if (loadparm) {
                ipl.loadparm = loadparm;
            }
            kv.ipl = PVE.Parser.printPropertyString(ipl, 'device');
        }
    },

    setArchitecture: function () {
        let me = this;
        let vm = me.getViewModel();

        let nodename = me.lookup('nodenameSelector').getValue();
        if (!nodename) {
            // we can't set an architecture if we don't have a nodename
            return;
        }
        // s390x nodes only run s390x VMs (KVM only), there is no architecture to choose
        let s390xNode = PVE.qemu.Architecture.getNodeArchitecture(nodename) === 's390x';
        let archSelector = me.lookup('archSelector');
        archSelector.setHidden(s390xNode);
        archSelector.setDisabled(s390xNode);
        if (s390xNode && archSelector.getValue() !== '__default__') {
            archSelector.setValue('__default__');
            return; // set again by the change event
        }
        let arch = archSelector.getValue();
        if (arch === '__default__') {
            arch = undefined;
        }
        arch = PVE.qemu.Architecture.getGuestArchitecture(arch, nodename);
        vm.set('current.architecture', arch);
    },

    referenceHolder: true,

    items: [
        {
            xtype: 'inputpanel',
            title: gettext('General'),
            onlineHelp: 'qm_general_settings',
            column1: [
                {
                    xtype: 'pveNodeSelector',
                    name: 'nodename',
                    reference: 'nodenameSelector',
                    cbind: {
                        selectCurNode: '{!nodename}',
                        preferredValue: '{nodename}',
                    },
                    bind: {
                        value: '{nodename}',
                    },
                    fieldLabel: gettext('Node'),
                    allowBlank: false,
                    onlineValidator: true,
                    listeners: {
                        change: function () {
                            this.up('window').setArchitecture();
                        },
                    },
                },
                {
                    xtype: 'pveGuestIDSelector',
                    name: 'vmid',
                    guestType: 'qemu',
                    value: '',
                    loadNextFreeID: true,
                    validateExists: false,
                },
                {
                    xtype: 'textfield',
                    name: 'name',
                    vtype: 'DnsName',
                    value: '',
                    fieldLabel: gettext('Name'),
                    allowBlank: true,
                },
                {
                    xtype: 'proxmoxcheckbox',
                    name: 'ha-managed',
                    // only submit value of checkbox if checked
                    uncheckedValue: undefined,
                    fieldLabel: gettext('Add to HA'),
                },
            ],
            column2: [
                {
                    xtype: 'pvePoolSelector',
                    fieldLabel: gettext('Resource Pool'),
                    name: 'pool',
                    value: '',
                    allowBlank: true,
                },
            ],
            advancedColumn1: [
                {
                    xtype: 'proxmoxcheckbox',
                    name: 'onboot',
                    uncheckedValue: 0,
                    defaultValue: 0,
                    deleteDefaultValue: true,
                    fieldLabel: gettext('Start at boot'),
                },
            ],
            advancedColumn2: [
                {
                    xtype: 'textfield',
                    name: 'order',
                    defaultValue: '',
                    emptyText: 'any',
                    labelWidth: 120,
                    fieldLabel: gettext('Start/Shutdown order'),
                },
                {
                    xtype: 'textfield',
                    name: 'up',
                    defaultValue: '',
                    emptyText: 'default',
                    labelWidth: 120,
                    fieldLabel: gettext('Startup delay'),
                },
                {
                    xtype: 'textfield',
                    name: 'down',
                    defaultValue: '',
                    emptyText: 'default',
                    labelWidth: 120,
                    fieldLabel: gettext('Shutdown timeout'),
                },
            ],

            advancedColumnB: [
                {
                    xtype: 'proxmoxKVComboBox',
                    name: 'arch',
                    value: '__default__',
                    reference: 'archSelector',
                    fieldLabel: gettext('vCPU Architecture'),
                    labelWidth: 120,
                    comboItems: PVE.qemu.Architecture.selection,
                    listeners: {
                        change: function () {
                            this.up('window').setArchitecture();
                        },
                    },
                },
                {
                    xtype: 'pveTagFieldSet',
                    name: 'tags',
                    maxHeight: 150,
                },
            ],

            onGetValues: function (values) {
                ['name', 'pool', 'onboot', 'agent'].forEach(function (field) {
                    if (!values[field]) {
                        delete values[field];
                    }
                });

                var res = PVE.Parser.printStartup({
                    order: values.order,
                    up: values.up,
                    down: values.down,
                });

                if (res) {
                    values.startup = res;
                }

                delete values.order;
                delete values.up;
                delete values.down;

                return values;
            },
        },
        {
            xtype: 'pveQemuOSPanel',
            title: gettext('OS'),
            bind: {
                arch: '{current.architecture}',
            },
        },
        {
            xtype: 'pveQemuSystemPanel',
            title: gettext('System'),
            isCreate: true,
            insideWizard: true,
        },
        {
            xtype: 'pveMultiHDPanel',
            bind: {
                nodename: '{nodename}',
            },
            title: gettext('Disks'),
        },
        {
            xtype: 'pveQemuProcessorPanel',
            insideWizard: true,
            title: gettext('CPU'),
            bind: {
                arch: '{current.architecture}',
            },
        },
        {
            xtype: 'pveQemuMemoryPanel',
            insideWizard: true,
            title: gettext('Memory'),
        },
        {
            xtype: 'pveQemuNetworkInputPanel',
            bind: {
                nodename: '{nodename}',
                arch: '{current.architecture}',
                ostype: '{current.ostype}',
            },
            title: gettext('Network'),
            insideWizard: true,
            listeners: {
                // the device number of a qeth adapter (s390x) is suggested for the new VM
                activate: function (panel) {
                    let wizard = panel.up('window');
                    let vmid = wizard.down('pveGuestIDSelector').getValue();
                    panel.setVMConfig(wizard.lookup('nodenameSelector').getValue(), vmid);
                },
            },
        },
        {
            title: gettext('Confirm'),
            layout: 'fit',
            items: [
                {
                    xtype: 'grid',
                    store: {
                        model: 'KeyValue',
                        sorters: [
                            {
                                property: 'key',
                                direction: 'ASC',
                            },
                        ],
                    },
                    columns: [
                        { header: gettext('Key'), width: 150, dataIndex: 'key' },
                        {
                            header: gettext('Value'),
                            flex: 1,
                            dataIndex: 'value',
                            renderer: Ext.htmlEncode,
                        },
                    ],
                },
            ],
            dockedItems: [
                {
                    xtype: 'proxmoxcheckbox',
                    name: 'start',
                    dock: 'bottom',
                    margin: '5 0 0 0',
                    boxLabel: gettext('Start after created'),
                },
            ],
            listeners: {
                show: function (panel) {
                    let wizard = this.up('window');
                    var kv = wizard.getValues();
                    var data = [];

                    let boot = wizard.calculateBootOrder(kv);
                    if (boot) {
                        kv.boot = boot;
                    }
                    wizard.calculateIPL(kv);

                    if (
                        kv.arch &&
                        !PVE.qemu.Architecture.isHostArchitecture(kv.arch, kv.nodename)
                    ) {
                        kv.kvm = 0;
                    }

                    Ext.Object.each(kv, function (key, value) {
                        if (key === 'delete') {
                            // ignore
                            return;
                        }
                        data.push({ key: key, value: value });
                    });

                    var summarystore = panel.down('grid').getStore();
                    summarystore.suspendEvents();
                    summarystore.removeAll();
                    summarystore.add(data);
                    summarystore.sort();
                    summarystore.resumeEvents();
                    summarystore.fireEvent('refresh');
                },
            },
            onSubmit: function () {
                var wizard = this.up('window');
                var kv = wizard.getValues();
                delete kv.delete;

                var nodename = kv.nodename;
                delete kv.nodename;

                let boot = wizard.calculateBootOrder(kv);
                if (boot) {
                    kv.boot = boot;
                }
                wizard.calculateIPL(kv);

                if (kv.arch && !PVE.qemu.Architecture.isHostArchitecture(kv.arch, nodename)) {
                    kv.kvm = 0;
                }

                Proxmox.Utils.API2Request({
                    url: '/nodes/' + nodename + '/qemu',
                    waitMsgTarget: wizard,
                    method: 'POST',
                    params: kv,
                    success: function (response) {
                        wizard.close();
                    },
                    failure: function (response, opts) {
                        Ext.Msg.alert(gettext('Error'), response.htmlStatus);
                    },
                });
            },
        },
    ],
});
