import {conn} from '../db'
import { Libro } from './libro.model';
import { BaseModel } from './base.model';
import { SaveTransaccion, TipoTransaccion, TransaccionSchema, tipoTransaccion } from '../schemas/transaccion.schema';
import { LibroCantidad } from '../schemas/libros.schema';
import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { filesUrl } from '../app';
import { Cliente } from './cliente.model';
import { ValidationError } from './errors';
import { User } from './user.model';
import { emitirComprobante } from '../comprobantes/comprobante';
import { TipoCliente, tipoCliente } from '../schemas/cliente.schema';

type libroTransaccionSchema = {
    cantidad: number;
    precio: number;
    id_libro: number;
    isbn: string;
    stock: number;
    titulo: string;
};

export class LibroTransaccion extends BaseModel {
    cantidad: number;
    precio: number;
    id_libro: number;
    
    isbn: string;
    stock: number;
    titulo: string;

    static table_name = "libros_transacciones";

    constructor(req: libroTransaccionSchema){
        super();

        this.cantidad = req.cantidad;
        this.precio = req.precio;
        
        this.id_libro = req.id_libro;
        this.isbn = req.isbn;
        this.stock = req.stock;
        this.titulo = req.titulo;
    }

    static async save(body: LibroTransaccion[], id_transaccion: number, connection: PoolConnection){
        const libros = body.map(libro => ({
            cantidad: libro.cantidad,
            precio: libro.precio,
            id_libro: libro.id_libro,
            id_transaccion: id_transaccion
        }));
        await this._bulk_insert(libros, connection);
    }
}

export interface ITransaccion {
    stockValidation(libros: LibroTransaccion[]): Promise<void>;
    stockMovement(libros: LibroTransaccion[], cliente: Cliente, conn: PoolConnection): Promise<void>;
    comprobante(libros: LibroTransaccion[], cliente: Cliente, user: User): void;
    clientValidation(tipo: TipoCliente): boolean

    getById(id: number): Promise<ITransaccion>;
    getLibros(): Promise<LibroTransaccion[]>;
    setLibros(body: LibroCantidad[], cliente: Cliente, userId: number): Promise<LibroTransaccion[]>;
}

export abstract class Transaccion extends BaseModel {
    static table_name = 'transacciones';
    static type: TipoTransaccion;
    static filesFolder: string;
    static pk = 'id';

    id: number;
    id_cliente: number;
    type: TipoTransaccion;
    file_path: string;
    fecha: Date;
    user: number;

    constructor(request: TransaccionSchema){
        super();

        this.id = request.id;
        this.id_cliente = request.id_cliente;
        this.type = request.type;
        this.file_path = request.file_path;
        this.fecha = request.fecha;
        this.user = request.user;
    }

    parsePath(filesFolder: string){
        this.file_path = this.file_path && this.file_path != "" ? `${filesUrl}/${filesFolder}/${this.file_path}` : this.file_path;
    }

    static async stockMovement(libros: LibroTransaccion[], cliente: Cliente, conn: PoolConnection): Promise<void>{console.error("UNEXPECTED")};
    comprobante(libros: LibroTransaccion[], cliente: Cliente, user: User): void{};
    static clientValidation(tipo: TipoCliente): boolean{return true};

    static async insert(body: SaveTransaccion, connection: PoolConnection){
        return await this._insert<SaveTransaccion, Transaccion>(body, connection);
    }

    static async getById(id: number){
        const transaccion = await this.find_one<TransaccionSchema, Transaccion>({
            id: id
        });
        transaccion.parsePath(this.filesFolder);
        return transaccion;
    }

    static async getWithOutParsing(id: number){
        const transaccion = await this.find_one<TransaccionSchema, Transaccion>({
            id: id
        });
        return transaccion;
    }

    /* 
        * Obtener los libros que se van a usar en la transaccion, con su precio y su stock
    */
    static async setLibros(body: LibroCantidad[], cliente: Cliente, userId: number, args?: object): Promise<LibroTransaccion[]>{
        let libros: LibroTransaccion[] = [];

        for (const libroBody of body) {
            const libro = await Libro.getByIsbn(libroBody.isbn, userId);

            libros.push(new LibroTransaccion({
                ...libro,
                cantidad: libroBody.cantidad,
                precio: libro.precio,
                id_libro: libro.id_libro
            }))
        }
        return libros;
    }

    async getLibros(): Promise<LibroTransaccion[]>{
        const [libros] = await conn.query<RowDataPacket[]>(`
            SELECT L.isbn, titulo, cantidad, LT.precio
            FROM libros L
            INNER JOIN ${LibroTransaccion.table_name} LT
                ON LT.id_libro = L.id_libro
            WHERE LT.id_transaccion = ?
        `, [this.id]);
        return libros as LibroTransaccion[];
    }

    static async getAll(userId: number){
        const [rows] = await conn.query<RowDataPacket[]>(`
            SELECT 
                T.id, T.id_cliente, T.fecha, 
                CONCAT('${filesUrl}', '/', '${this.filesFolder}', '/', T.file_path) AS file_path,
                cuit, nombre as nombre_cliente, email, cond_fiscal, C.tipo
            FROM ${Transaccion.table_name} T
            INNER JOIN clientes C
                ON T.id_cliente = C.id
            WHERE T.user = ?
            AND T.type = ?
            ORDER BY T.id DESC
        `, [userId, this.type]);
        return rows;
    }
}

export class Consignacion extends Transaccion {
    static filesFolder = "remitos";
    static type = tipoTransaccion.consignacion;

    static clientValidation(tipo: TipoCliente): boolean {
        return tipo == tipoCliente.inscripto   
    }

    static async stockMovement(libros: LibroTransaccion[], cliente: Cliente, connection: PoolConnection){
        for (const libro of libros) {
            await Libro.updateStock(libro.id_libro, -libro.cantidad, connection);
        }

        await cliente.addStock(libros, connection);
    }

    comprobante(libros: LibroTransaccion[], cliente: Cliente, user: User){
        console.log("generando comprobante dentro");
        emitirComprobante({
            data: {
                consignacion: this,
                cliente: cliente,
                libros: libros
            }, 
            user: user, 
        });
        this.parsePath(Consignacion.filesFolder);
    }
}

export class Devolucion extends Transaccion {
    static type = tipoTransaccion.devolucion;

    static async setLibros(body: LibroCantidad[], cliente: Cliente, userId: number, args?: object): Promise<LibroTransaccion[]>{
        let libros: LibroTransaccion[] = [];

        const librosCliente = await cliente.getLibros(userId); 

        for (const _libro of body) {
            const libroCliente = librosCliente.find(l => l.isbn == _libro.isbn);
            if (libroCliente === undefined){
                throw new ValidationError(`El cliente no tiene registrados precios del libro ${_libro.isbn} para esta fecha`)
            }

            libros.push(new LibroTransaccion({
                ...libroCliente,
                cantidad: _libro.cantidad,
                precio: libroCliente.precio,
            }))
        }

        return libros;
    }

    static async stockMovement(libros: LibroTransaccion[], cliente: Cliente, connection: PoolConnection){
        for (const libro of libros){
            await Libro.updateStock(libro.id_libro, libro.cantidad, connection);
        }

        await cliente.reduceStock(libros, connection);
    }

    static clientValidation(tipo: TipoCliente): boolean {
        return tipo == tipoCliente.inscripto 
    }

    comprobante(_: LibroTransaccion[], __: Cliente, ___: User){
        this.file_path = "";
    }
}
