// Punto de entrada exigido por BP/manifest.json. La lógica de inicio vive en core.
// Esta importación debe registrarse antes de Creative+ para que una construcción
// protegida nunca sea reemplazada por su atajo de edición.
import './features/structures/protection.js';
import './core/bootstrap.js';
import './features/structures/placement.js';
