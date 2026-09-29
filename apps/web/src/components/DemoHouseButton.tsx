import { useMutation, useQueryClient } from '@tanstack/react-query';

import { houseApi } from '../api.js';

export function DemoHouseButton() {
  const queryClient = useQueryClient();
  const join = useMutation({
    mutationFn: houseApi.joinDemo,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['house-context'] });
    },
  });
  return <div className="demo-house-entry">
    <p>Для показа возможностей можно открыть вымышленный дом. Его дела и опросы помечены как демо-данные и доступны другим участникам. Не указывайте личные сведения.</p>
    <button type="button" className="button button--secondary"
      onClick={() => join.mutate()} disabled={join.isPending}>
      {join.isPending ? 'Открываем дом…' : 'Открыть демонстрационный дом'}
    </button>
    {join.isError ? <p className="form-error">{join.error.message}</p> : null}
  </div>;
}
