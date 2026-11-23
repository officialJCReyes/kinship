# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Seeds a stack running KinShip 0.3.0-rc.1 (sourced by scripts/upgrade-test.sh). The release candidate has the same API and
# schema as 0.3.0 except the separate surname particle, which 0.3.0 folds into the surname (migration 0024), so it is the 0.3.0
# seed with SEED_PARTICLES=1: it also stores two particles through the rc's API, and the checks after the upgrade prove the
# fold (ADR 0037: an rc seed is a wrapper; ADR 0038 adds the flag).
SEED_PARTICLES=1
# shellcheck source=scripts/upgrade-test/seed-0.3.0.sh
. "$(dirname "${BASH_SOURCE[0]}")/seed-0.3.0.sh"
