package PVE::S390xPort;

# The package repository of the Proxmox VE s390x port and what comes from it on s390x nodes.
#
# Proxmox's repositories (download.proxmox.com, enterprise.proxmox.com) have no s390x packages,
# the port's packages come from its own repository, the Proxmox-390 repository. That one is
# recognised by its signing key (the keyring of its Signed-By option), the origin of its Release
# file, its public URL or the name of the source file the installer writes. Mirrors may serve it
# from other hosts, so none of these is required alone. Older installs have the names of the
# port's test repository (source file proxport.sources, keyring proxport-archive-keyring.gpg,
# origin 'proxport'), which are still recognised.
#
#   - The APT repository API lists it as the standard repository 's390x-port', so that the node
#     summary and the Repositories panel know a Proxmox VE repository is configured.
#   - Its container template index (aplinfo) is published next to it, at
#     <repository URL>/images/aplinfo-pve-9-s390x.dat (.gz, signed .asc), signed with the key of
#     the repository; pveam uses it instead of Proxmox's and TurnKey's indexes, which have no
#     s390x templates.

use strict;
use warnings;

use File::Basename qw(basename);

use PVE::Tools;

our $REPO_HANDLE = 's390x-port';
our $REPO_NAME = 'Proxmox-390 repository';
our $KEYRING = '/usr/share/keyrings/proxmox-390-archive-keyring.gpg';
our $URL = 'https://proxmox-390-apt.legitimatebusiness.be';
our $SOURCES_DIR = '/etc/apt/sources.list.d';

# the keyrings, origins and source file names of the repository, current ones first
our @KEYRINGS = ('proxmox-390-archive-keyring.gpg', 'proxport-archive-keyring.gpg');
our @ORIGINS = ('proxmox-390', 'proxport');
our @SOURCE_FILES = ('proxmox-390.sources', 'proxport.sources');
our $APLINFO_FILE = 'aplinfo-pve-9-s390x.dat';

sub is_s390x {
    return PVE::Tools::get_host_arch() eq 's390x';
}

# Whether a repository entry is the port's repository: by its Signed-By keyring file, the origin
# of its Release file, its first URI or the name of its source file (see the top).
sub is_port_repository {
    my ($signed_by, $origin, $uri, $path) = @_;

    return 1 if defined($signed_by) && grep { basename($signed_by) eq $_ } @KEYRINGS;
    return 1 if defined($origin) && grep { lc($origin) eq $_ } @ORIGINS;
    if (defined($uri)) {
        # the URL itself or a path below it
        return 1 if index(lc($uri) . '/', lc($URL) . '/') == 0;
    }
    return 1 if defined($path) && grep { basename($path) eq $_ } @SOURCE_FILES;
    return 0;
}

# The port's repository in parsed APT repository information (as returned by
# Proxmox::RS::APT::Repositories::repositories()): a 'deb' entry recognised by
# is_port_repository(), an enabled one if there are several. Returns undef or
# { uri => <first URI, without a trailing slash>, keyring => <Signed-By file>, enabled => 0|1 }.
sub find_repository {
    my ($info) = @_;

    my $origins = {};
    for my $entry (@{ $info->{infos} // [] }) {
        next if ($entry->{kind} // '') ne 'origin';
        $origins->{"$entry->{path}:$entry->{index}"} = $entry->{message};
    }

    my $found;
    for my $file (@{ $info->{files} // [] }) {
        my $index = 0;
        for my $repo (@{ $file->{repositories} // [] }) {
            my $origin = $origins->{"$file->{path}:$index"} // '';
            $index++;

            next if !grep { $_ eq 'deb' } @{ $repo->{Types} // [] };
            my ($signed_by) = map { @{ $_->{Values} // [] } }
                grep { lc($_->{Key}) eq 'signed-by' } @{ $repo->{Options} // [] };
            # an inline key (deb822 Signed-By block) is no file name
            $signed_by = undef if defined($signed_by) && $signed_by !~ m|^/|;

            my $uri = $repo->{URIs}->[0] // next;
            next if !is_port_repository($signed_by, $origin, $uri, $file->{path});

            $uri =~ s|/+$||;
            my $entry = {
                uri => $uri,
                keyring => $signed_by // $KEYRING,
                enabled => $repo->{Enabled} ? 1 : 0,
            };
            return $entry if $entry->{enabled};
            $found //= $entry;
        }
    }
    return $found;
}

# The standard repository entry for the APT repository API.
sub standard_repository {
    my ($info) = @_;

    my $repo = find_repository($info);
    return {
        handle => $REPO_HANDLE,
        name => $REPO_NAME,
        description => "The Proxmox-390 repository: the Proxmox VE packages built for s390x"
            . " (IBM Z, LinuxONE). It is configured by the installer.",
        defined($repo) ? (status => $repo->{enabled}) : (),
    };
}

# The template index (aplinfo source, see PVE::APLInfo) of the port's enabled repository, or undef.
sub aplinfo_source {
    my $info = eval {
        require Proxmox::RS::APT::Repositories;
        Proxmox::RS::APT::Repositories::repositories("pve");
    };
    if (my $err = $@) {
        warn "unable to read the APT repositories - $err";
        return undef;
    }
    my $repo = find_repository($info);
    return undef if !$repo || !$repo->{enabled} || $repo->{uri} !~ m|^https?://|;

    return {
        host => $REPO_HANDLE, # the name of the cached index in the apl-info directory
        url => "$repo->{uri}/images",
        file => $APLINFO_FILE,
        keyring => $repo->{keyring},
    };
}

# The source file of the port's repository that the installer wrote: the first of @SOURCE_FILES
# in $dir (default $SOURCES_DIR) that exists, or undef.
sub sources_file {
    my ($dir) = @_;

    $dir //= $SOURCES_DIR;
    for my $name (@SOURCE_FILES) {
        return "$dir/$name" if -f "$dir/$name";
    }
    return undef;
}

# The deb822 APT source of the port's Ceph repository for Ceph release $cephver (like 'squid' or
# 'tentacle'). Proxmox has no Ceph packages for s390x; the port publishes them like Proxmox does,
# at <repository URL>/ceph-<codename> (suite trixie, component main), signed with the same key. So
# the URI and keyring are those of the first 'deb' entry of the port's source file (see
# sources_file()) in $dir.
sub ceph_repo_source {
    my ($cephver, $dir) = @_;

    my $file = sources_file($dir);
    die "s390x: no Proxmox-390 repository source ("
        . join(' or ', @SOURCE_FILES) . " in "
        . ($dir // $SOURCES_DIR)
        . "), configure a Ceph repository and use"
        . " '--repository manual'\n"
        if !defined($file);

    my $raw = PVE::Tools::file_get_contents($file);
    my ($uri, $keyring);
    # the first stanza with type 'deb' (stanzas are separated by empty lines)
    for my $stanza (split(/\n\s*\n/, $raw)) {
        my ($types) = $stanza =~ m/^Types:[ \t]*(.*)$/mi;
        next if !defined($types) || !grep { $_ eq 'deb' } split(/\s+/, $types);
        next if $stanza =~ m/^Enabled:[ \t]*no\b/mi;
        ($uri) = $stanza =~ m/^URIs:[ \t]*(\S+)/mi;
        ($keyring) = $stanza =~ m/^Signed-By:[ \t]*(\/\S+)/mi;
        last if defined($uri);
    }
    die "s390x: no enabled 'deb' entry with URIs in '$file'\n" if !defined($uri);
    $uri =~ s!/+$!!;

    my $source = "Types: deb\nURIs: ${uri}/ceph-${cephver}\nSuites: trixie\nComponents: main\n";
    $source .= "Signed-By: ${keyring}\n" if defined($keyring);
    return $source;
}

1;
