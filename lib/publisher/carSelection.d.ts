export type CarType = 'auto' | 'suv' | 'saloon' | 'coupe_gt' | 'sports_car' | 'convertible' | 'supercar' | 'luxury_van';
export type CarBrandId = 'auto' | 'land-rover' | 'porsche' | 'bentley' | 'lamborghini' | 'mercedes-benz';
export interface CarSelection {
  carType: CarType;
  carBrand: CarBrandId;
  carModel: string;
}
export interface CarReference {
  readonly id: string;
  readonly manufacturer: string;
  readonly model: string;
  readonly variant: string;
  readonly generation: string;
  readonly types: readonly Exclude<CarType, 'auto'>[];
  readonly visualFeatures: readonly string[];
  readonly sources: readonly string[];
  readonly verifiedOn: string;
}
export interface CarBrand {
  readonly id: Exclude<CarBrandId, 'auto'>;
  readonly label: string;
}
export const CAR_TYPES: readonly CarType[];
export const CAR_CATALOGUE_VERSION: string;
export const CAR_CATALOGUE: readonly CarReference[];
export function normalizeCarType(value?: unknown): CarType;
export function availableCarBrands(type?: string): CarBrand[];
export function availableCarModels(type?: string, brand?: string): CarReference[];
export function normalizeCarSelection(value?: { carType?: unknown; carBrand?: unknown; carModel?: unknown }): CarSelection;
export function reconcileCarSelection(previous?: Partial<CarSelection>, next?: Partial<CarSelection>): {
  selection: CarSelection;
  reset: { brand: boolean; model: boolean };
};
