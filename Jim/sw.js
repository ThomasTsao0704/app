const CACHE="pwa-cache-v2";

const FILES=[
"/",
"/index.html",
"/manifest.json",
"/offline.html"
];

self.addEventListener("install",e=>{

e.waitUntil(
caches.open(CACHE)
.then(c=>c.addAll(FILES))
);

self.skipWaiting();

});

self.addEventListener("activate",e=>{

e.waitUntil(
caches.keys().then(keys=>
Promise.all(
keys.map(k=>{
if(k!==CACHE)return caches.delete(k);
})
)
)
);

self.clients.claim();

});

self.addEventListener("fetch",e=>{

e.respondWith(

caches.match(e.request)
.then(res=>{

if(res) return res;

return fetch(e.request)
.catch(()=>caches.match("/offline.html"));

})

);

});