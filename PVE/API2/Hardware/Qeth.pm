package PVE::API2::Hardware::Qeth;

# s390x: the qeth network devices (OSA-Express, HiperSockets) of the node, see PVE::S390xQeth.

use strict;
use warnings;

use PVE::JSONSchema qw(get_standard_option);
use PVE::RPCEnvironment;
use PVE::Tools;

use PVE::S390xQeth;

use base qw(PVE::RESTHandler);

my sub assert_s390x {
    die "qeth devices exist on s390x nodes only\n" if PVE::Tools::get_host_arch() ne 's390x';
}

my $device_schema = {
    type => "object",
    properties => {
        id => {
            type => 'string',
            description => "The CCW group ID: read, write and data device.",
        },
        device => {
            type => 'string',
            description => "The read device, which names the qeth device.",
        },
        online => {
            type => 'boolean',
            description => "The device is online (has a network interface).",
        },
        persistent => {
            type => 'boolean',
            description => "The device is configured persistently.",
        },
        names => {
            type => 'array',
            items => { type => 'string' },
            description => "The network interfaces of the device.",
        },
        'in-use' => {
            type => 'string',
            optional => 1,
            description => "Online devices the node uses: why the device cannot be set"
                . " offline (an interface of it in the network configuration, the management"
                . " address of the node on it).",
        },
    },
};

my $device_param = {
    type => 'string',
    pattern => '(?:[0-9a-fA-F]{1,2}\.[0-3]\.[0-9a-fA-F]{4})'
        . '(?:(?::[0-9a-fA-F]{1,2}\.[0-3]\.[0-9a-fA-F]{4}){2})?',
    description => "The qeth device: its read device (e.g. 0.0.0610) or its CCW group ID.",
};

__PACKAGE__->register_method({
    name => 'list',
    path => '',
    method => 'GET',
    description => "s390x only: list the qeth network devices (OSA-Express, HiperSockets) of"
        . " the node, online or not ('lszdev qeth').",
    protected => 1,
    proxyto => "node",
    permissions => {
        check => ['perm', '/nodes/{node}', ['Sys.Audit']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
        },
    },
    returns => {
        type => 'array',
        items => $device_schema,
    },
    code => sub {
        my ($param) = @_;

        assert_s390x();
        return PVE::S390xQeth::list_devices_with_usage();
    },
});

__PACKAGE__->register_method({
    name => 'enable',
    path => '',
    method => 'POST',
    description => "s390x only: set an offline qeth network device online in layer 2 mode, now"
        . " and persistently ('chzdev -e qeth'), so that the node gets its network interface."
        . " Runs as a task.",
    protected => 1,
    proxyto => "node",
    permissions => {
        check => ['perm', '/nodes/{node}', ['Sys.Modify']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            device => $device_param,
            'bridge-port' => {
                type => 'boolean',
                optional => 1,
                default => 0,
                description => "The device will be the port of a bridge: it reflects the"
                    . " promiscuous mode of the bridge (bridge_reflect_promisc=primary), so the"
                    . " OSA passes the frames for the guests behind the bridge to it.",
            },
        },
    },
    returns => {
        type => 'string',
        description => "The UPID of the task.",
    },
    code => sub {
        my ($param) = @_;

        assert_s390x();
        PVE::S390xQeth::check_tools();

        my $rpcenv = PVE::RPCEnvironment::get();
        my $authuser = $rpcenv->get_user();
        my $device = lc($param->{device});
        # the task ID is the read device (the UPID has ':' as its separator)
        my ($task_id) = split(/:/, $device);

        return $rpcenv->fork_worker(
            'qethonline',
            $task_id,
            $authuser,
            sub {
                print "setting qeth device $device online (layer 2"
                    . ($param->{'bridge-port'} ? ", bridge port" : '') . ")\n";
                my $dev = PVE::S390xQeth::enable($device, $param->{'bridge-port'});
                print "qeth device $dev->{id} is online, interface: "
                    . (join(', ', @{ $dev->{names} // [] }) || 'none yet') . "\n";
            },
        );
    },
});

__PACKAGE__->register_method({
    name => 'disable',
    path => '',
    method => 'DELETE',
    description => "s390x only: set an online qeth network device offline, now and"
        . " persistently ('chzdev -d qeth'): its network interface goes away. Refused for a"
        . " device the node uses: one with an interface in the network configuration of the"
        . " node, or with the management address of the node on it.",
    protected => 1,
    proxyto => "node",
    permissions => {
        check => ['perm', '/nodes/{node}', ['Sys.Modify']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            device => $device_param,
        },
    },
    returns => {
        type => 'string',
        description => "The UPID of the task.",
    },
    code => sub {
        my ($param) = @_;

        assert_s390x();
        PVE::S390xQeth::check_tools();

        my $rpcenv = PVE::RPCEnvironment::get();
        my $authuser = $rpcenv->get_user();
        my $device = lc($param->{device});
        # the task ID is the read device (the UPID has ':' as its separator)
        my ($task_id) = split(/:/, $device);

        return $rpcenv->fork_worker(
            'qethoffline',
            $task_id,
            $authuser,
            sub {
                print "setting qeth device $device offline\n";
                my $dev = PVE::S390xQeth::disable($device);
                print "qeth device $dev->{id} is offline\n";
            },
        );
    },
});

1;
