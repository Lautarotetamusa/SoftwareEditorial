import { Request, Response, NextFunction } from "express";
import { ValidationError, parse_error } from '../models/errors';

import { LiquidacionValidator } from "../schemas/liquidacion.schema";

import { Liquidacion } from "../models/liquidacion.model";
import { Libro } from "../models/libro.model";

const create = async (req: Request, res: Response): Promise<Response> => {
    try {
        LiquidacionValidator.create(req.body);
        let _liq = req.body;

        if (!(await Liquidacion.valid_period(_liq.fecha_inicial, _liq.fecha_final)))
            throw new ValidationError("Ya existe una liquidacion en el periodo seleccionado");

        const libro = await Libro.get_by_isbn(_liq.isbn);

        const persona = await Persona.get_by_id(_liq.id_persona);

        const ventas = await Liquidacion.get_ventas(_liq);
        let total: number = ventas.reduce((total, row) => total + row.cantidad * row.precio_venta, 0);
        let file_path = "TEST";

        const liquidacion = await Liquidacion.insert({
            ..._liq,
            total: total, 
            file_path: file_path,
        });

        return res.status(201).json({
            success: true,
            message: "Liquidacion creada con exito",
            data: {
                ...liquidacion,
                personas: personas
            }
        });

    } catch (error: any) {
        return parse_error(res, error);
    }
}

const get_one = async (req: Request, res: Response): Promise<Response> => {
    try{
        if (!('id' in req.params))
            throw new ValidationError("Se debe pasar un id para obtener la liquidacion")
        const id = Number(req.params.id);

        const liquidacion = await Liquidacion.get_one(id);
        const libro = await Libro.get_by_isbn(liquidacion.isbn);
        const ventas = await liquidacion.get_details();

        return res.status(200).json({
            ...liquidacion,
            libro: libro,
            ventas: ventas
        });

    }catch (error: any){
        return parse_error(res, error);
    }
}

const get_all = async (req: Request, res: Response): Promise<Response> => {
    try{
        const liquidaciones = await Liquidacion.get_all();

        return res.status(200).json(liquidaciones);
    }catch (error: any){
        return parse_error(res, error);
    }
}
export default {
    create,
    get_one,
    get_all
}
