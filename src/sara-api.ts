const collections = ['clients','opportunities','products','aromas','quotes','orders','samples','appointments','tasks','notifications','audit','conversations'];
let baseline:any, revision:number, queue=Promise.resolve();
const listeners = new Set<(event: string) => void>();
function emit(event: string) { for (const listener of listeners) listener(event); }
export function subscribe(callback: (event: string) => void) { listeners.add(callback); return () => { listeners.delete(callback); }; }
async function request(path:string,body?:any) {
  const response = await fetch(`/api/sara${path}`,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,credentials:'same-origin'});
  const result=await response.json();
  if(!response.ok) {
    if(response.status===401 && path!=='/auth/login') emit('SIGNED_OUT');
    throw Object.assign(new Error(result.error || 'No se pudo conectar con el CRM.'),{status:response.status});
  }
  return result;
}
export async function load(force=false) {
  await queue;
  const result=await request(force?'/refresh':'/state',force?{}:undefined);
  baseline=structuredClone(result.state);revision=result.revision;return result.state;
}
export async function peek() { return request('/state'); }
export function push(state:any) {
  const current=structuredClone(state);
  const operation=queue.then(async()=>{
    if(!baseline)throw new Error('Carga los datos antes de guardar.');
    const changes=[];
    for(const collection of collections){
      const old=new Map((baseline[collection] || []).map((r:any)=>[r.id,r]));
      const ids=new Set((current[collection] || []).map((r:any)=>r.id));
      for(const row of current[collection] || []) if(JSON.stringify(old.get(row.id))!==JSON.stringify(row)) changes.push({collection,id:row.id,operation:'put',value:row});
      if(['tasks','appointments'].includes(collection))for(const id of old.keys())if(!ids.has(id))changes.push({collection,id,operation:'delete'});
    }
    const discountLimit=current.discountLimit!==baseline.discountLimit?current.discountLimit:undefined;
    if(!changes.length && discountLimit===undefined)return;
    const result=await request('/sync',{revision,changes,discountLimit});revision=result.revision;baseline=current;
  });
  queue=operation.catch(()=>{});return operation;
}
export const context=async()=> (await request('/session')).context;
export async function login(username: string,password: string) {
  const result=await request('/auth/login',{username,password});
  baseline=undefined;queue=Promise.resolve();emit('SIGNED_IN');return result;
}
export async function logout() {
  await queue;
  await request('/auth/logout',{});
  baseline=undefined;queue=Promise.resolve();emit('SIGNED_OUT');
}
