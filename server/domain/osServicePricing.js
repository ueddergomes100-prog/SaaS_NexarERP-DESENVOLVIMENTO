"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getServiceTotal = exports.getServiceHours = void 0;
const getServiceHours = (service) => {
    if (service.tempoHoras === undefined || service.tempoHoras === null || service.tempoHoras === '') {
        return Math.max(0, Number(service.quantidade || 1));
    }
    return Math.max(0, Number(service.tempoHoras || 0));
};
exports.getServiceHours = getServiceHours;
const getServiceTotal = (service) => Number(service.preco || 0) * (0, exports.getServiceHours)(service);
exports.getServiceTotal = getServiceTotal;
