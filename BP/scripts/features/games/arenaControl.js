import { ScriptEventSource, system, world } from '@minecraft/server';
import { legacyArena, validateArena } from './arenaSchema.js';
const PROPERTY = 'spb:pvp_arenas_v1';
let state;
let changing = false;
export function arenaState() {
    if (!state) {
        const saved = world.getDynamicProperty(PROPERTY);
        state = typeof saved === 'string' ? JSON.parse(saved) : { revision: 0, arenas: [legacyArena], active: null, history: [] };
        if (!Number.isSafeInteger(state.revision) || !Array.isArray(state.arenas))
            throw new Error('La configuración guardada de arenas no es válida.');
        state.arenas = state.arenas.map(validateArena);
        if (state.active)
            state.active = validateArena(state.active);
    }
    return state;
}
export function arenaChanging() { return changing; }
export function installArenaControl(options) {
    const pending = new Map();
    function reply(request, result) {
        const data = encodeURIComponent(JSON.stringify(result));
        const count = Math.ceil(data.length / 1000);
        for (let i = 0; i < count; i++)
            console.warn(`SPB_PVP ${request} ${i}/${count} ${data.slice(i * 1000, (i + 1) * 1000)}`);
    }
    async function execute(request, payload) {
        let acquired = false;
        try {
            const input = JSON.parse(decodeURIComponent(payload));
            const current = arenaState();
            if (input.action === 'list') {
                reply(request, { ok: true, state: current, busy: options.busy() || changing });
                return;
            }
            if (changing || options.busy())
                throw new Error('Hay una partida o una activación en curso. Espera a que termine.');
            if (input.revision !== current.revision)
                throw new Error('La configuración cambió en otra sesión. Recarga antes de guardar.');
            const next = JSON.parse(JSON.stringify(current));
            let id = typeof input.id === 'string' ? input.id : '';
            if (input.action === 'save') {
                const arena = validateArena(input.arena);
                id = arena.id;
                next.arenas = next.arenas.filter(item => item.id !== id).concat(arena);
                if (next.arenas.length > 12)
                    throw new Error('Se permiten hasta 12 arenas por mundo.');
            }
            else if (input.action === 'delete') {
                if (current.active?.id === id)
                    throw new Error('Desactiva la arena antes de eliminarla.');
                if (!next.arenas.some(item => item.id === id))
                    throw new Error('La arena ya no existe.');
                next.arenas = next.arenas.filter(item => item.id !== id);
            }
            else if (input.action === 'activate') {
                const arena = next.arenas.find(item => item.id === id);
                if (!arena)
                    throw new Error('Guarda la arena antes de activarla.');
                changing = true;
                acquired = true;
                await options.prepare(arena);
                next.active = arena;
            }
            else if (input.action === 'deactivate') {
                next.active = null;
            }
            else
                throw new Error('Acción inválida.');
            next.revision++;
            next.history.unshift({ at: new Date().toISOString(), action: input.action, arena: id || current.active?.id || '', actor: 'Administrador del dashboard' });
            next.history = next.history.slice(0, 10);
            const serialized = JSON.stringify(next);
            if (serialized.length > 28000)
                throw new Error('La configuración supera el tamaño permitido.');
            world.setDynamicProperty(PROPERTY, serialized);
            if (input.action === 'activate' || input.action === 'deactivate')
                options.apply(next.active);
            state = next;
            reply(request, { ok: true, state, busy: false });
        }
        catch (error) {
            reply(request, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
        finally {
            if (acquired)
                changing = false;
        }
    }
    system.afterEvents.scriptEventReceive.subscribe(event => {
        if (event.id !== 'spb:pvp_admin' || event.sourceType !== ScriptEventSource.Server)
            return;
        // Commands are split to stay below the existing bridge's 512-character limit.
        const match = /^([a-f0-9]{12}) (\d+) (.*)$/.exec(event.message);
        if (!match)
            return;
        const [, request, part, data] = match;
        for (const [key, item] of pending)
            if (Date.now() - item.at > 30000)
                pending.delete(key);
        const index = Number(part);
        if (index > 20 || data.length > 400)
            return;
        if (index === 0) {
            if (pending.size >= 16)
                return;
            pending.set(request, { at: Date.now(), parts: [] });
        }
        const item = pending.get(request);
        if (!item || item.parts.length !== index)
            return;
        if (data === 'COMMIT') {
            pending.delete(request);
            void execute(request, item.parts.join(''));
        }
        else
            item.parts.push(data);
    }, { namespaces: ['spb'] });
}
//# sourceMappingURL=arenaControl.js.map