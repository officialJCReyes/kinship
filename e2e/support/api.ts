// SPDX-License-Identifier: AGPL-3.0-or-later
// Quick ways to set a test up (sign in, create people) without clicking through the screens. The things a
// test is *about* are always done through the UI.
import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { BASE_URL } from './stack.js';

const HEADERS = { 'X-KinShip-Request': '1', Origin: BASE_URL };

export interface Made {
  id: string;
  givenName: string;
  surname: string;
}

export async function signIn(page: Page, email: string, password: string): Promise<void> {
  const response = await page.request.post('/api/auth/login', { headers: HEADERS, data: { email, password } });
  expect(response.status(), 'sign in through the API').toBe(200);
}

export async function createPerson(
  request: APIRequestContext,
  input: {
    givenName: string;
    surname: string;
    gender?: 'male' | 'female' | 'other';
    birth?: string;
    deceased?: boolean;
    death?: string;
    secondSurname?: string;
    marriedSurname?: string;
    namePrefix?: string;
    nameSuffix?: string;
    nickname?: string;
    surnameParticle?: string;
  },
): Promise<Made> {
  const body = {
    givenName: input.givenName,
    surname: input.surname,
    secondSurname: input.secondSurname ?? null,
    marriedSurname: input.marriedSurname ?? null,
    namePrefix: input.namePrefix ?? null,
    nameSuffix: input.nameSuffix ?? null,
    nickname: input.nickname ?? null,
    surnameParticle: input.surnameParticle ?? null,
    gender: input.gender ?? null,
    birth: input.birth ? { value: input.birth } : null,
    deceased: input.deceased ?? false,
    death: input.death ? { value: input.death } : null,
  };
  const response = await request.post('/api/people', { headers: HEADERS, data: body });
  expect(response.status(), 'create a person through the API').toBe(201);
  const json = (await response.json()) as { person: Made };
  return json.person;
}

export async function createUnion(
  request: APIRequestContext,
  a: string,
  b: string,
  status: string,
  start?: string,
): Promise<string> {
  const response = await request.post('/api/unions', {
    headers: HEADERS,
    data: { partnerIds: [a, b].sort(), status, start: start ? { value: start } : null },
  });
  expect(response.status(), 'create a relationship through the API').toBe(201);
  return ((await response.json()) as { union: { id: string } }).union.id;
}

export async function createChild(
  request: APIRequestContext,
  parentId: string,
  child: { givenName: string; surname: string; gender?: 'male' | 'female' },
  unionId?: string,
): Promise<Made> {
  const response = await request.post(`/api/people/${parentId}/children`, {
    headers: HEADERS,
    data: { child: { ...child, gender: child.gender ?? null }, ...(unionId ? { unionId } : {}) },
  });
  expect(response.status(), 'add a child through the API').toBe(201);
  return ((await response.json()) as { person: Made }).person;
}
