# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Seeds a stack running KinShip 0.3.0-rc.3 (sourced by scripts/upgrade-test.sh). The release candidate has the same API and
# schema as 0.3.0 (migration 0024 included), so it is the 0.3.0 seed (ADR 0037: an rc seed is a wrapper).
# No SEED_PARTICLES=1: rc.3's API refuses surnameParticle (ADR 0038); the rc.1 and rc.2 pins keep testing the fold.
# shellcheck source=scripts/upgrade-test/seed-0.3.0.sh
. "$(dirname "${BASH_SOURCE[0]}")/seed-0.3.0.sh"
