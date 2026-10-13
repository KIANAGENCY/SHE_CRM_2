export const stages = [
  "Nuevo prospecto",
  "Asesoría con Sara",
  "Cotización",
  "Confirmación",
];
export const orderStages = [
  "Por autorizar",
  "En producción",
  "Empacado",
  "En tránsito",
  "Entregado",
];
export const sampleStages = [
  "Solicitada",
  "En preparación",
  "Enviada",
  "En evaluación",
  "Evaluada",
];
export function seed() {
  return {version:2,initialized:false,role:"Dirección",discountLimit:0,clients:[],opportunities:[],products:[],aromas:[],quotes:[],orders:[],samples:[],appointments:[],tasks:[],notifications:[],audit:[],conversations:[]};
}
