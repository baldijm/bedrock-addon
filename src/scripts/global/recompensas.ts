import { Player } from '@minecraft/server';
import { entregarRedDiamonds } from './moneda.js';
import { actualizarResumenRanking, agregarPuntos } from './ranking.js';

type Recompensa = {
  puntos: number;
  diamantes: number;
};

/**
 * Entrega una recompensa de juego. Los puntos dan prestigio; los red diamonds
 * son moneda física para intercambiar o gastar en la tienda.
 */
export function entregarRecompensa(player: Player, recompensa: Recompensa): void {
  if (recompensa.puntos < 0 || recompensa.diamantes < 0) {
    throw new Error('Una recompensa no puede restar puntos ni red diamonds.');
  }

  if (recompensa.diamantes > 0) {
    entregarRedDiamonds(player, recompensa.diamantes);
  }

  if (recompensa.puntos > 0) {
    agregarPuntos(player, recompensa.puntos);
    return;
  }

  actualizarResumenRanking(player);
}
