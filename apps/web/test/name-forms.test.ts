// SPDX-License-Identifier: AGPL-3.0-or-later
import { displayName, displaySurname, marriedPart } from '@kinship/shared';
import type { NameForm } from '@kinship/shared';
import { describe, expect, it } from 'vitest';

const FORMS: NameForm[] = ['maiden_married', 'married_born', 'married', 'maiden'];
const rosa = { givenName: 'Rosa', surname: 'Mendez', marriedSurname: 'Mendez Hale' };

describe('the four forms (ADR 0024)', () => {
  it('writes a married woman’s name in each form', () => {
    expect(displayName(rosa, 'maiden_married')).toBe('Rosa Mendez (Hale)');
    expect(displayName(rosa, 'married_born')).toBe('Rosa Mendez Hale (born Mendez)');
    expect(displayName(rosa, 'married')).toBe('Rosa Mendez Hale');
    expect(displayName(rosa, 'maiden')).toBe('Rosa Mendez');
  });

  it('is Maiden name (Married name) by default', () => {
    expect(displayName(rosa)).toBe('Rosa Mendez (Hale)');
  });

  it('shows the maiden name, surname plus second surname, in every form for a person with no married surname', () => {
    const lucia = { givenName: 'Lucia', surname: 'Ortiz', secondSurname: 'Vega' };
    for (const form of FORMS) expect(displayName(lucia, form), form).toBe('Lucia Ortiz Vega');
    for (const form of FORMS)
      expect(displayName({ ...lucia, marriedSurname: '' }, form), form).toBe('Lucia Ortiz Vega');
  });

  it('strips a leading maiden name from the married surname, ignoring case and accents, whole words only', () => {
    expect(marriedPart('Mendez Hale', 'Mendez')).toBe('Hale');
    expect(marriedPart('MÉNDEZ hale', 'mendez')).toBe('hale');
    expect(marriedPart('Mendez Ortiz Hale', 'Mendez Ortiz')).toBe('Hale');
    expect(marriedPart('Mendezo Hale', 'Mendez')).toBe('Mendezo Hale');
    expect(marriedPart('Mendez-Hale', 'Mendez')).toBe('Mendez-Hale');
    expect(marriedPart('Hale', 'Mendez')).toBe('Hale');
    expect(marriedPart('Mendez', 'Mendez')).toBeNull();
  });

  it('tries the surname plus second surname first, then the surname alone', () => {
    const both = { givenName: 'Rosa', surname: 'Mendez', secondSurname: 'Ortiz', marriedSurname: 'Mendez Ortiz Hale' };
    expect(displayName(both)).toBe('Rosa Mendez Ortiz (Hale)');
    const first = { ...both, marriedSurname: 'Mendez Hale' };
    expect(displayName(first)).toBe('Rosa Mendez Ortiz (Hale)');
    expect(displayName({ ...both, marriedSurname: 'Quiroga' })).toBe('Rosa Mendez Ortiz (Quiroga)');
  });

  it('shows the maiden name alone when the married surname adds nothing to it', () => {
    expect(displayName({ ...rosa, marriedSurname: 'Mendez' })).toBe('Rosa Mendez');
    expect(displayName({ ...rosa, marriedSurname: 'mendez' }, 'married')).toBe('Rosa Mendez');
  });

  it('puts the particle before the birth surname only, never before a married surname', () => {
    const bea = { givenName: 'Beatriz', surname: 'Navarro', surnameParticle: 'de', marriedSurname: 'Hale' };
    expect(displayName(bea, 'maiden_married')).toBe('Beatriz de Navarro (Hale)');
    expect(displayName(bea, 'married')).toBe('Beatriz Hale');
    expect(displayName(bea, 'married_born')).toBe('Beatriz Hale (born de Navarro)');
    expect(displayName(bea, 'maiden')).toBe('Beatriz de Navarro');
    expect(displaySurname({ ...bea, marriedSurname: null })).toBe('de Navarro');
  });

  it('adds the prefix and suffix when the account shows them, and never the nickname', () => {
    const dr = { givenName: 'Samuel', surname: 'Hale', namePrefix: 'Dr.', nameSuffix: 'Jr.', nickname: 'Sam' };
    expect(displayName(dr)).toBe('Dr. Samuel Hale Jr.');
    expect(displayName(dr, { showPrefix: false })).toBe('Samuel Hale Jr.');
    expect(displayName(dr, { showSuffix: false })).toBe('Dr. Samuel Hale');
    expect(displayName(dr, { showPrefix: false, showSuffix: false })).toBe('Samuel Hale');
    expect(displayName(dr)).not.toContain('Sam ');
  });

  it('gives the longest realistic name in full, in order', () => {
    const long = {
      givenName: 'Beatriz',
      surname: 'Navarro',
      secondSurname: 'Ortiz',
      surnameParticle: 'de la',
      marriedSurname: 'Hernandez-Hale',
      namePrefix: 'Dra.',
      nameSuffix: 'Jr.',
    };
    expect(displayName(long)).toBe('Dra. Beatriz de la Navarro Ortiz (Hernandez-Hale) Jr.');
  });
});
