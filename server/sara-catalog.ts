// Fuentes autorizadas: Precios Hotel Expert.pdf y Catalogo Aromas Hotel Expert ELAH.pdf, 12/10/2026.
// Importes de referencia en MXN más IVA; no representan inventario, disponibilidad ni una cotización formal.
const productRows: [string, string, string, number][] = [
  ['estandar','Hotel Expert Estándar','2 L concentrado · rinde 20 L',450],
  ['dual','Hotel Expert Dual','2 L concentrado · rinde 20 L',550],
  ['aroma-difusor','Aroma para difusor','1 L',1799],
  ['caja-aromas','Caja de aromas','15 atomizadores',999],
  ['descontaminador','Descontaminador de habitaciones','2 L · rinde 20 L',1999],
  ['difusor-pequeno','Difusor para espacios pequeños','Aproximadamente 50 m²',999],
  ['difusor-lobby','Difusor para espacios grandes','Lobbies',3999],
];
export const products = productRows.map(([id,name,size,price])=>({id:`catalogo-${id}`,name,size,price,sku:'',source:'documentos-autorizados',taxExcluded:true}));
export const aromas = [
  ['Bambú Menta','Verde','Verde y refrescante, dulce, limpio y revitalizante.'],
  ['Té Blanco','Fresco','Suave, fresco, cítrico y ligeramente floral.'],
  ['O. Bergamot','Cítrico','Cítrico y elegante, suave y sofisticado.'],
  ['Sandel','Amaderado','Sándalo, cedro y matices cálidos.'],
  ['Pepino Melón','Fresco','Fresco, acuático y dulce.'],
  ['Frutos Rojos','Frutal','Dulce y frutal; moras, fresa y frambuesa.'],
  ['Sencha Loz','Herbal','Aromático y herbal, frescura del té verde.'],
  ['Oriental Citrus','Cítrico','Cítrico con fondo cálido.'],
  ['Cedar','Amaderado','Cedro con matices ahumados.'],
  ['Té Verde','Herbal','Verde y fresco, herbal, limpio y natural.'],
].map(([name,family,notes],index)=>({id:`catalogo-aroma-${index+1}`,name,family,notes,intensity:'',areas:'',products:[],approved:true,source:'documentos-autorizados'}));
