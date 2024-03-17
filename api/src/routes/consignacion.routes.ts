import express from "express"

import ConsignacionController from "../controllers/consignacion.controller"

const router = express.Router();

router.post('/', ConsignacionController.consignar);

router.get('/', ConsignacionController.getAll);

router.get('/:id', ConsignacionController.getOne);

export default router;
