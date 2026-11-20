#!/usr/bin/perl

use v5.36;

use lib ('.', '..');

use Test::MockModule;
use Test::More;

use PVE::S390xQeth;

# 'lszdev qeth --pairs --columns ID,ON,PERS,NAMES' of an LPAR (s390-tools 2.31), with a
# device of another channel subsystem and lines lszdev never prints, which must be skipped
my $lszdev = <<'EOF';
ID="0.0.0600:0.0.0601:0.0.0602" ON="yes" PERS="yes" NAMES="enc600"
ID="0.0.0300:0.0.0301:0.0.0302" ON="yes" PERS="yes" NAMES="enc300"
ID="0.0.0403:0.0.0404:0.0.0405" ON="no" PERS="no" NAMES=""
ID="0.0.0609:0.0.060a:0.0.060b" ON="no" PERS="yes" NAMES=""
ID="1.0.7000:1.0.7001:1.0.7002" ON="no" PERS="no" NAMES=""
ID="0.0.0603:0.0.0604:0.0.0605" ON="yes" PERS="no" NAMES="enc603 enc603d"
ID="0.0.0200" ON="yes" PERS="yes" NAMES="sda"
ID="0.0.0700:0.0.0701" ON="no" PERS="no" NAMES=""
garbage
EOF

my $devices = PVE::S390xQeth::parse_lszdev_pairs($lszdev);

is_deeply(
    [map { $_->{id} } @$devices],
    [
        '0.0.0300:0.0.0301:0.0.0302',
        '0.0.0403:0.0.0404:0.0.0405',
        '0.0.0600:0.0.0601:0.0.0602',
        '0.0.0603:0.0.0604:0.0.0605',
        '0.0.0609:0.0.060a:0.0.060b',
        '1.0.7000:1.0.7001:1.0.7002',
    ],
    'qeth groups only, sorted by read device',
);

is_deeply(
    $devices->[0],
    {
        id => '0.0.0300:0.0.0301:0.0.0302',
        device => '0.0.0300',
        online => 1,
        persistent => 1,
        names => ['enc300'],
    },
    'online device',
);
is_deeply(
    $devices->[1],
    {
        id => '0.0.0403:0.0.0404:0.0.0405',
        device => '0.0.0403',
        online => 0,
        persistent => 0,
        names => [],
    },
    'offline device',
);
is($devices->[4]->{persistent}, 1, 'offline device with a persistent configuration');
is_deeply($devices->[3]->{names}, ['enc603', 'enc603d'], 'several interface names');

is_deeply(PVE::S390xQeth::parse_lszdev_pairs(''), [], 'no qeth devices');
is_deeply(PVE::S390xQeth::parse_lszdev_pairs(undef), [], 'no output');

my $upper = PVE::S390xQeth::parse_lszdev_pairs('ID="0.0.0A00:0.0.0A01:0.0.0A02" ON="no"');
is($upper->[0]->{device}, '0.0.0a00', 'bus IDs in lower case');

is(
    PVE::S390xQeth::find_device($devices, '0.0.0403')->{id},
    '0.0.0403:0.0.0404:0.0.0405',
    'find by read device',
);
is(
    PVE::S390xQeth::find_device($devices, '0.0.0403:0.0.0404:0.0.0405')->{device},
    '0.0.0403',
    'find by group ID',
);
is(PVE::S390xQeth::find_device($devices, '0.0.0404'), undef, 'write device names no device');
is(PVE::S390xQeth::find_device($devices, '0.0.0200'), undef, 'FCP device is no qeth device');

is_deeply(
    PVE::S390xQeth::enable_command($devices->[1], 0),
    [
        $PVE::S390xQeth::CHZDEV,
        '--enable',
        '--yes',
        'qeth',
        '0.0.0403:0.0.0404:0.0.0405',
        'layer2=1',
    ],
    'enable command',
);
is_deeply(
    PVE::S390xQeth::enable_command($devices->[1], 1),
    [
        $PVE::S390xQeth::CHZDEV,
        '--enable',
        '--yes',
        'qeth',
        '0.0.0403:0.0.0404:0.0.0405',
        'layer2=1',
        'bridge_reflect_promisc=primary',
    ],
    'enable command for a bridge port',
);

# enable(), with lszdev and chzdev mocked
$PVE::S390xQeth::LSZDEV = '/bin/true';
$PVE::S390xQeth::CHZDEV = '/bin/sh'; # any executable, distinct from lszdev
my $commands = [];
my $online = {};
my $chzdev_error;
my $mock = Test::MockModule->new('PVE::S390xQeth');
$mock->redefine(
    run_command => sub {
        my ($cmd, %param) = @_;
        push @$commands, $cmd;
        if ($cmd->[0] eq $PVE::S390xQeth::CHZDEV && $cmd->[1] eq '--enable') {
            if ($chzdev_error) {
                $param{errfunc}->($chzdev_error);
                die "command failed: exit code 1\n";
            }
            $online->{ $cmd->[4] } = 1;
            return;
        }
        for my $line (split(/\n/, $lszdev)) {
            my ($id) = $line =~ m/^ID="([^"]+)"/;
            $line =~ s/ON="no"/ON="yes"/ if $id && $online->{$id};
            $param{outfunc}->($line);
        }
    },
);

my $chzdev_calls = sub { [grep { $_->[0] eq $PVE::S390xQeth::CHZDEV } @$commands] };

my $res = PVE::S390xQeth::enable('0.0.0403', 1);
is($res->{online}, 1, 'enable: device online afterwards');
is_deeply(
    $chzdev_calls->(),
    [[
        $PVE::S390xQeth::CHZDEV,
        '--enable',
        '--yes',
        'qeth',
        '0.0.0403:0.0.0404:0.0.0405',
        'layer2=1',
        'bridge_reflect_promisc=primary',
    ]],
    'enable: chzdev called once for the group',
);

for my $case (
    ['0.0.0300', qr/is online already/, 'online device refused'],
    ['0.0.0200', qr/is no qeth device/, 'FCP device refused'],
    ['0.0.0404', qr/is no qeth device/, 'write device refused'],
    ['0.0.0403; reboot', qr/invalid qeth device/, 'invalid device refused'],
    ['', qr/invalid qeth device/, 'empty device refused'],
) {
    my ($device, $re, $name) = @$case;
    $commands = [];
    eval { PVE::S390xQeth::enable($device) };
    like($@, $re, $name);
    is(scalar($chzdev_calls->()->@*), 0, "$name: chzdev not called");
}

$chzdev_error = 'Error: qeth device 0.0.0609:0.0.060a:0.0.060b: Invalid attribute value';
eval { PVE::S390xQeth::enable('0.0.0609') };
like(
    $@,
    qr/setting qeth device 0\.0\.0609:0\.0\.060a:0\.0\.060b online failed: .*Invalid attribute/,
    'chzdev error passed on',
);

done_testing();
