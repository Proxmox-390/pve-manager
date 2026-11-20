#!/usr/bin/perl

use v5.36;

use lib ('.', '..');

use File::Temp qw(tempdir);
use Test::More;

use PVE::Tools;

use PVE::S390xPort;

# recognising the repository
my $is_port = \&PVE::S390xPort::is_port_repository;
ok(
    $is_port->(
        '/usr/share/keyrings/proxmox-390-archive-keyring.gpg',
        '',
        'https://mirror.example/x',
    ),
    'current keyring',
);
ok($is_port->('/etc/apt/keyrings/proxport-archive-keyring.gpg', '', 'http://x'), 'old keyring');
ok($is_port->(undef, 'Proxmox-390', 'http://mirror.example/p'), 'current origin');
ok($is_port->(undef, 'proxport', 'http://mirror.example/p'), 'old origin');
ok($is_port->(undef, '', 'https://proxmox-390-apt.legitimatebusiness.be'), 'public URL');
ok($is_port->(undef, '', 'https://proxmox-390-apt.legitimatebusiness.be/'), 'public URL with /');
ok(
    $is_port->(undef, '', 'https://Proxmox-390-APT.legitimatebusiness.be/sub'),
    'path below the public URL',
);
ok(
    !$is_port->(undef, '', 'https://proxmox-390-apt.legitimatebusiness.be.example.org'),
    'other host with the URL as prefix',
);
ok(
    $is_port->(undef, '', 'http://mirror.example/p', '/etc/apt/sources.list.d/proxmox-390.sources'),
    'current source file',
);
ok(
    $is_port->(undef, '', 'http://mirror.example/p', '/etc/apt/sources.list.d/proxport.sources'),
    'old source file',
);
ok(
    !$is_port->(
        '/usr/share/keyrings/debian-archive-keyring.gpg',
        'Debian',
        'http://deb.debian.org/debian',
        '/etc/apt/sources.list.d/debian.sources',
    ),
    'Debian repository',
);
ok(
    !$is_port->(
        '/usr/share/keyrings/proxmox-archive-keyring.gpg',
        'Proxmox',
        'http://download.proxmox.com/debian/pve',
        '/etc/apt/sources.list.d/pve-no-subscription.sources',
    ),
    'Proxmox repository',
);

# in parsed APT repository information: by file name only, without a keyring or origin
my $info = {
    files => [
        {
            path => '/etc/apt/sources.list.d/debian.sources',
            repositories =>
                [{ Types => ['deb'], URIs => ['http://deb.debian.org/debian'], Enabled => 1 }],
        },
        {
            path => '/etc/apt/sources.list.d/proxmox-390.sources',
            repositories => [
                {
                    Types => ['deb'],
                    URIs => ['https://mirror.example/proxmox-390/'],
                    Enabled => 1,
                },
            ],
        },
    ],
    infos => [],
};
is_deeply(
    PVE::S390xPort::find_repository($info),
    {
        uri => 'https://mirror.example/proxmox-390',
        keyring => $PVE::S390xPort::KEYRING,
        enabled => 1,
    },
    'repository found by its source file',
);
is(PVE::S390xPort::standard_repository($info)->{status}, 1, 'standard repository enabled');
is(
    PVE::S390xPort::find_repository({ files => [$info->{files}->[0]], infos => [] }),
    undef,
    'no port repository',
);

# the source file and the Ceph repository derived from it
my $dir = tempdir(CLEANUP => 1);
is(PVE::S390xPort::sources_file($dir), undef, 'no source file');
like(
    (eval { PVE::S390xPort::ceph_repo_source('squid', $dir) } // $@),
    qr/no Proxmox-390 repository source \(proxmox-390\.sources or proxport\.sources/,
    'Ceph repository without a source file',
);

PVE::Tools::file_set_contents("$dir/proxport.sources", <<'EOS');
Types: deb
URIs: http://old.example/proxport/
Suites: trixie
Components: main
Signed-By: /usr/share/keyrings/proxport-archive-keyring.gpg
EOS
is(PVE::S390xPort::sources_file($dir), "$dir/proxport.sources", 'old source file');
is(
    PVE::S390xPort::ceph_repo_source('squid', $dir),
    "Types: deb\nURIs: http://old.example/proxport/ceph-squid\nSuites: trixie\nComponents: main\n"
        . "Signed-By: /usr/share/keyrings/proxport-archive-keyring.gpg\n",
    'Ceph repository from the old source file',
);

PVE::Tools::file_set_contents("$dir/proxmox-390.sources", <<'EOS');
# Proxmox-390 repository, written by the installer
Types: deb-src
URIs: https://src.example/
Suites: trixie
Components: main

Types: deb
URIs: https://proxmox-390-apt.legitimatebusiness.be
Suites: trixie
Components: main
Signed-By: /usr/share/keyrings/proxmox-390-archive-keyring.gpg
EOS
is(PVE::S390xPort::sources_file($dir), "$dir/proxmox-390.sources", 'current source file first');
is(
    PVE::S390xPort::ceph_repo_source('tentacle', $dir),
    "Types: deb\nURIs: https://proxmox-390-apt.legitimatebusiness.be/ceph-tentacle\n"
        . "Suites: trixie\nComponents: main\n"
        . "Signed-By: /usr/share/keyrings/proxmox-390-archive-keyring.gpg\n",
    'Ceph repository from the current source file',
);

PVE::Tools::file_set_contents("$dir/proxmox-390.sources", <<'EOS');
Types: deb
URIs: https://mirror.example/p
Suites: trixie
Components: main
Signed-By:
 -----BEGIN PGP PUBLIC KEY BLOCK-----
 .
 -----END PGP PUBLIC KEY BLOCK-----
EOS
is(
    PVE::S390xPort::ceph_repo_source('squid', $dir),
    "Types: deb\nURIs: https://mirror.example/p/ceph-squid\nSuites: trixie\nComponents: main\n",
    'inline key: no keyring file',
);

PVE::Tools::file_set_contents(
    "$dir/proxmox-390.sources",
    "Types: deb\nEnabled: no\nURIs: http://x\n",
);
like(
    (eval { PVE::S390xPort::ceph_repo_source('squid', $dir) } // $@),
    qr/no enabled 'deb' entry with URIs/,
    'disabled entry',
);

done_testing();
