package PVE::S390xPort;

# The package repository of the Proxmox VE s390x port and what comes from it on s390x nodes.
#
# Proxmox's repositories (download.proxmox.com, enterprise.proxmox.com) have no s390x packages,
# the port's packages come from its own repository. That one is recognised by its signing key (the
# keyring of its Signed-By option) or by the origin of its Release file, not by a URL: test
# installs and production mirrors serve it from different hosts.
#
#   - The APT repository API lists it as the standard repository 's390x-port', so that the node
#     summary and the Repositories panel know a Proxmox VE repository is configured.

use strict;
use warnings;

use File::Basename qw(basename);

use PVE::Tools;

our $REPO_HANDLE = 's390x-port';
our $REPO_NAME = 'Proxmox VE s390x port';
our $KEYRING = '/usr/share/keyrings/proxport-archive-keyring.gpg';
our $ORIGIN = 'proxport';

sub is_s390x {
    return PVE::Tools::get_host_arch() eq 's390x';
}

# The port's repository in parsed APT repository information (as returned by
# Proxmox::RS::APT::Repositories::repositories()): a 'deb' entry signed with the port's keyring
# or with the port's origin, an enabled one if there are several. Returns undef or
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

            my $ours = (defined($signed_by) && basename($signed_by) eq basename($KEYRING))
                || lc($origin) eq $ORIGIN;
            next if !$ours;

            my $uri = $repo->{URIs}->[0] // next;
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
        description => "The repository of the Proxmox VE port to s390x (IBM Z, LinuxONE), with"
            . " the packages built for s390x. It is configured by the installer.",
        defined($repo) ? (status => $repo->{enabled}) : (),
    };
}

1;
