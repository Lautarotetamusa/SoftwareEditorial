import {Request, Response} from "express";
import { ValidationError } from "../models/errors"
import { LibroTransaccion, Transaccion } from "../models/transaccion.model";
import { createTransaccion } from "../schemas/transaccion.schema";
import { Cliente } from "../models/cliente.model";
import { conn } from "../db";
import { emitirComprobante } from "../comprobantes/comprobante";
import { User } from "../models/user.model";

const getOne = (transaccion: typeof Transaccion) => {
    return async (req: Request, res: Response): Promise<Response> => {
        const id = Number(req.params.id);
        if (!id) throw new ValidationError("El id debe ser un numero");

        const t = await transaccion.getById(id);
        const libros = await t.getLibros();
        return res.json({
            ...t,
            libros: libros
        });
    }
}

const getAll = (transaccion: typeof Transaccion) => {
    return async (_: Request, res: Response): Promise<Response> => {
        const t = await transaccion.getAll(res.locals.user.id);
        return res.json(t);
    }
}   

const generateComprobante = (transaccion: typeof Transaccion) => {
    return async (req: Request, res: Response): Promise<Response> => {
        const id = Number(req.params.id);
        if (!id) throw new ValidationError("El id debe ser un numero");

        const user = await User.getById(res.locals.user.id);
        const t = await transaccion.getWithOutParsing(id);
        const cliente = await Cliente.getById(t.id_cliente, user.id);
        const libros = await t.getLibros();
        emitirComprobante({
            data: {
                consignacion: Object.assign({}, t),
                cliente: cliente,
                libros: libros
            }, 
            user: user, 
        });

        t.parsePath(transaccion.filesFolder);

        return res.status(201).json({
            success: true,
            message: "Comprobante generado correctamente",
            data: t,
        });
    }
}   

export const transaccion = (transaccion: typeof Transaccion) => {
    return async(req: Request, res: Response): Promise<Response> => {
        const connection = await conn.getConnection();

        const user: User = await User.getById(res.locals.user.id);
        const body = createTransaccion.parse(req.body);
        const cliente = await Cliente.getById(body.cliente, user.id);
    
        try{
            await connection.beginTransaction();

            if (!transaccion.clientValidation(cliente.tipo)){
                throw new ValidationError(`No se le puede hacer una ${transaccion.type} a un cliente de tipo ${cliente.tipo}`);
            }

            const libros = await transaccion.setLibros(body.libros, cliente, user.id);
            for (const libro of libros){
                if (libro.stock < libro.cantidad){
                    throw new ValidationError(`El libro ${libro.titulo} con isbn ${libro.isbn} no tiene suficiente stock`)
                }
            }

            const transaction = await Transaccion.insert({
                type: transaccion.type,
                id_cliente: cliente.id,
                file_path: cliente.generatePath(),
                user: user.id
            }, connection);
            await LibroTransaccion.save(libros, transaction.id, connection);

            await transaccion.stockMovement(libros, cliente, connection);
            emitirComprobante({
                data: {
                    consignacion: Object.assign({}, transaction),
                    cliente: cliente,
                    libros: libros
                }, 
                user: user, 
            });
            transaction.parsePath(transaccion.filesFolder);
            await connection.commit();

            return res.status(201).json({
                success: true,
                message: `Se realizó la ${transaccion.type} correctamente`,
                data: transaction
            });
        }catch(err){
            await connection.rollback();
            console.log("Se realizo un rollback");
            throw err;
        }
    }
};

export default{
    getOne,
    getAll,
    transaccion,
    generateComprobante,
}
