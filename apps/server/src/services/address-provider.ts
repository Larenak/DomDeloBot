import type { AddressSuggestionDto } from '@domdelo/contracts';

export type VerifiedHouse = {
  fiasId: string;
  address: string;
  city: string;
  street: string;
  building: string;
  region?: string;
};

export interface AddressProvider {
  suggest(query: string): Promise<AddressSuggestionDto[]>;
  resolveHouse(fiasId: string): Promise<VerifiedHouse | null>;
}

export class AddressProviderUnavailableError extends Error {
  constructor(message = 'Сервис адресов временно недоступен. Попробуйте позже.') {
    super(message);
  }
}

type DadataAddress = {
  value?: string | null;
  data?: {
    country_iso_code?: string | null;
    city?: string | null;
    region_with_type?: string | null;
    settlement?: string | null;
    area?: string | null;
    street?: string | null;
    house?: string | null;
    block?: string | null;
    block_type?: string | null;
    house_fias_id?: string | null;
    fias_id?: string | null;
    fias_level?: string | null;
    fias_actuality_state?: string | null;
  } | null;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const baseUrl = 'https://suggestions.dadata.ru/suggestions/api/4_1/rs';

export class DadataAddressProvider implements AddressProvider {
  constructor(private readonly apiKey?: string) {}

  private async request(path: string, body: object): Promise<DadataAddress[]> {
    if (!this.apiKey) {
      throw new AddressProviderUnavailableError('Подбор адресов ещё не настроен. Добавьте DADATA_API_KEY на сервере.');
    }
    try {
      const response = await fetch(`${baseUrl}/${path}/address`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Token ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new AddressProviderUnavailableError();
      const payload = await response.json() as { suggestions?: DadataAddress[] };
      if (!Array.isArray(payload.suggestions)) throw new AddressProviderUnavailableError();
      return payload.suggestions;
    } catch (error) {
      if (error instanceof AddressProviderUnavailableError) throw error;
      throw new AddressProviderUnavailableError();
    }
  }

  async suggest(query: string): Promise<AddressSuggestionDto[]> {
    const results = await this.request('suggest', { query, count: 10 });
    return results
      .filter((item) => item.value && item.data?.country_iso_code === 'RU' &&
        (item.data.fias_actuality_state === null || item.data.fias_actuality_state === undefined ||
          item.data.fias_actuality_state === '0'))
      .map((item) => {
        const data = item.data!;
        const houseId = data.house_fias_id;
        const isHouse = Boolean(
          houseId && uuidPattern.test(houseId) && data.house &&
          data.fias_level === '8',
        );
        return {
          value: item.value!,
          isHouse,
          ...(isHouse ? { fiasId: houseId!.toLowerCase() } : {}),
        };
      });
  }

  async resolveHouse(fiasId: string): Promise<VerifiedHouse | null> {
    if (!uuidPattern.test(fiasId)) return null;
    const results = await this.request('findById', { query: fiasId });
    const found = results.find((item) => {
      const data = item.data;
      return item.value && data?.country_iso_code === 'RU' && data.house &&
        data.house_fias_id?.toLowerCase() === fiasId.toLowerCase() &&
        data.fias_id?.toLowerCase() === fiasId.toLowerCase() &&
        data.fias_level === '8' && data.fias_actuality_state === '0';
    });
    if (!found?.data?.house || !found.value) return null;
    const data = found.data;
    const city = data.city || data.settlement || data.area;
    if (!city) return null;
    return {
      fiasId: fiasId.toLowerCase(),
      address: found.value,
      city,
      ...(data.region_with_type ? { region: data.region_with_type } : {}),
      street: data.street || '',
      building: [data.house, data.block ? `${data.block_type || 'к'} ${data.block}` : ''].filter(Boolean).join(' '),
    };
  }
}

export class DemoAddressProvider implements AddressProvider {
  private readonly house: VerifiedHouse = {
    fiasId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    address: 'г. Казань, ул. Спортивная, д. 12 (демо)',
    city: 'Казань', street: 'Спортивная', building: '12',
  };

  async suggest(query: string): Promise<AddressSuggestionDto[]> {
    return this.house.address.toLocaleLowerCase('ru-RU').includes(query.toLocaleLowerCase('ru-RU'))
      ? [{ value: this.house.address, fiasId: this.house.fiasId, isHouse: true }] : [];
  }

  async resolveHouse(fiasId: string): Promise<VerifiedHouse | null> {
    return fiasId === this.house.fiasId ? this.house : null;
  }
}
