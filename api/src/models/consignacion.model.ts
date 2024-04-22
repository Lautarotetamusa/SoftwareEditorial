import { Libro } from './libro.model'
import { ValidationError } from './errors';
import { LibroCantidad, LibroSchema } from '../schemas/libros.schema';
import { ConsignacionSchema, SaveConsignacion } from '../schemas/consignaciones.schema';
import { BaseModel } from './base.model';
import { PersonaLibroPersonaSchema } from '../schemas/libro_persona.schema';
import { StockCliente } from '../schemas/cliente.schema';
import { conn } from '../db';
import { RowDataPacket } from 'mysql2';
import { filesUrl } from '../app';
import { Cliente } from './cliente.model';

export class LibroConsignacion extends Libro {
    cantidad: number;
    autores: PersonaLibroPersonaSchema[];
    ilustradores: PersonaLibroPersonaSchema[];

    static table_name = "libros_consignaciones";

    constructor(body: {
        libro: LibroSchema, 
        cantidad: number, 
        autores: PersonaLibroPersonaSchema[], 
        ilustradores: PersonaLibroPersonaSchema[]
    }){
        super(body.libro);
        
        this.cantidad = body.cantidad;
        this.autores = body.autores;
        this.ilustradores = body.ilustradores;
    }

    static async bulk_insert(body: LibroCantidad[]){
       this._bulk_insert(body); 
    }

    static async setLibros(body: StockCliente, userId: number): Promise<LibroConsignacion[]>{
        let libros: LibroConsignacion[] = [];
        for (const libroBody of body) {
            const libro = await Libro.getByIsbn(libroBody.isbn, userId);
            const {autores, ilustradores} = await libro.getPersonas(userId);

            libros.push(new LibroConsignacion({
                libro: libro,
                cantidad: libroBody.cantidad,
                autores: autores,
                ilustradores: ilustradores
            }));

            if (libro.stock < libroBody.cantidad){
                throw new ValidationError(`El libro ${libro.titulo} con isbn ${libro.isbn} no tiene suficiente stock`);
            }
        }

        return libros;        
    }
}

export class Consignacion extends BaseModel{
    static table_name = "consignaciones";
    static filesFolder = "remitos";

    id: number;
    remito_path: string;
    id_cliente: number;

    constructor(body: ConsignacionSchema){
        super();

        this.remito_path = body.remito_path;
        this.id = body.id;
        this.id_cliente = body.id_cliente;
    }

    parsePath(){
        this.remito_path = this.remito_path ? `${filesUrl}/${Consignacion.filesFolder}/${this.remito_path}` : this.remito_path;
    }

    static async insert(body: SaveConsignacion){
        return await Consignacion._insert<SaveConsignacion, Consignacion>(body);
    }

    static async getById(id: number){
        const consignacion = await this.find_one<ConsignacionSchema, Consignacion>({id: id});
        consignacion.parsePath();
        return consignacion;
    }

    async getLibros(): Promise<LibroConsignacion[]>{
        const [libros] = await conn.query<RowDataPacket[]>(`
            SELECT libros.isbn, titulo, cantidad 
            FROM libros
            INNER JOIN ${LibroConsignacion.table_name} LC
                ON LC.isbn = libros.isbn
            WHERE LC.id_consignacion = ?
        `, [this.id]);
        return libros as LibroConsignacion[];
    }

    static async getAll(userId: number){
        const [rows] = await conn.query(`
            SELECT 
                Con.id, fecha, 
                CONCAT ('${filesUrl}', '/', '${Consignacion.filesFolder}', '/', remito_path) AS remito_path,
                cuit, nombre as nombre_cliente, email, cond_fiscal, tipo
            FROM ${Consignacion.table_name} Con
            INNER JOIN ${Cliente.table_name} Cli
                ON Con.id_cliente = Cli.id
            WHERE Con.user = ?
            ORDER BY Con.id DESC
        `, [userId]);
        return rows;
    }
}
