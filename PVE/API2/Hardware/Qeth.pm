package PVE::API2::Hardware::Qeth;

# s390x: the qeth network devices (OSA-Express, HiperSockets) of the node, see PVE::S390xQeth.

use strict;
use warnings;

use PVE::JSONSchema qw(get_standard_option);
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
    },
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
        return PVE::S390xQeth::list_devices();
    },
});

__PACKAGE__->register_method({
    name => 'enable',
    path => '',
    method => 'POST',
    description => "s390x only: set an offline qeth network device online in layer 2 mode, now"
        . " and persistently ('chzdev -e qeth'), so that the node gets its network interface.",
    protected => 1,
    proxyto => "node",
    permissions => {
        check => ['perm', '/nodes/{node}', ['Sys.Modify']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            device => {
                type => 'string',
                pattern => '(?:[0-9a-fA-F]{1,2}\.[0-3]\.[0-9a-fA-F]{4})'
                    . '(?:(?::[0-9a-fA-F]{1,2}\.[0-3]\.[0-9a-fA-F]{4}){2})?',
                description => "The qeth device: its read device (e.g. 0.0.0610) or its CCW"
                    . " group ID.",
            },
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
    returns => $device_schema,
    code => sub {
        my ($param) = @_;

        assert_s390x();
        return PVE::S390xQeth::enable($param->{device}, $param->{'bridge-port'});
    },
});

1;
