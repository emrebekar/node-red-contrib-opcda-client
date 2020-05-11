module.exports = function(RED) {
	const opcda = require('node-opc-da');
    const { OPCServer } = opcda;
    const { ComServer, Session, Clsid } = opcda.dcom;
	
	const errorCode = {
		0x80040154 : "Clsid is not found.",
		0x00000005 : "Access denied. Username and/or password might be wrong.",
		0xC0040006 : "The Items AccessRights do not allow the operation.",
		0xC0040004 : "The server cannot convert the data between the specified format/ requested data type and the canonical data type.",
		0xC004000C : "Duplicate name not allowed.",
		0xC0040010 : "The server's configuration file is an invalid format.",
		0xC0040009 : "The filter string was not valid",
		0xC0040001 : "The value of the handle is invalid. Note: a client should never pass an invalid handle to a server. If this error occurs, it is due to a programming error in the client or possibly in the server.",
		0xC0040008 : "The item ID doesn't conform to the server's syntax.",
		0xC0040203 : "The passed property ID is not valid for the item.",
		0xC0040011 : "Requested Object (e.g. a public group) was not found.",
		0xC0040005 : "The requested operation cannot be done on a public group.",
		0xC004000B : "The value was out of range.",
		0xC0040007 : "The item ID is not defined in the server address space (on add or validate) or no longer exists in the server address space (for read or write).",
		0xC004000A : "The item's access path is not known to the server.",
		0x0004000E : "A value passed to WRITE was accepted but the output was clamped.",
		0x0004000F : "The operation cannot be performed because the object is being referenced.",
		0x0004000D : "The server does not support the requested data rate but will use the closest available rate.",
		0x00000061 : "Clsid syntax is invalid"
	};
	
	RED.httpAdmin.get('/opcda/browse', RED.auth.needsPermission('node-opc-da.list'), function (req, res) {
        let params = req.query
        async function browseItems() {
			try{
				var session = new Session();
				session = session.createSession(params.domain, params.username, params.password);
				session.setGlobalSocketTimeout(params.timeout);

				var comServer = new ComServer(new Clsid(params.clsid), params.address, session);
				await comServer.init();
				
				var comObject = await comServer.createInstance();
		
				var opcServer = new opcda.OPCServer();
				await opcServer.init(comObject);

				var opcBrowser = await opcServer.getBrowser();
				var itemList = await opcBrowser.browseAllFlat();

				opcBrowser.end()
					.then(() => opcServer.end())
					.then(() => comServer.closeStub())
					.catch(e => RED.log.error(`Error closing browse session: ${e}`));

				res.status(200).send({items : itemList});
			}
			catch(e){
				var msg = errorCode[e] ? errorCode[e] : "Unknown error.";
				RED.log.error(msg);
				res.status(500).send({error : msg});
			}
		}
		
		browseItems();
    });

    function OPCDAServer(config) {
        RED.nodes.createNode(this,config);
        const node = this;
				
		if (!node.credentials) {
            return node.error("Failed to load credentials!");
        }	

		node.busy = false;
		let comSession, comServer;
		let groupNodes = new Map();
						
		node.isConnected = false;
		
		//init();
				
		async function init(){
			try{
				await serverStatusChanged('connecting');
				
				node.busy = true;
				var timeout = parseInt(config.timeout);
			
				comSession = new Session();
				comSession = comSession.createSession(config.domain, node.credentials.username, node.credentials.password);
				comSession.setGlobalSocketTimeout(timeout);
								
				comServer = new ComServer(new Clsid(config.clsid), config.address, comSession);	
				
				comServer.on('disconnected',function(){
					serverStatusChanged('disconnected');
					node.reconnect();
				});
				
				await comServer.init();
				
				var comObject = await comServer.createInstance();
				node.opcServer = new OPCServer();		
				await node.opcServer.init(comObject);
						
				node.isConnected = true;
				await serverStatusChanged('connected');
			}
			catch(e){
				onError(e);
			}
			finally{
				node.busy = false;
			}
		}
				
		async function destroy(){
			node.busy = true;
			try{
				if(node.opcServer){
					await node.opcServer.end();
					node.opcServer = null;
				}
				
				if(comServer){
					await comServer.closeStub()
					comServer = null;
				}
				
				if(comSession){
					await comSession.destroySession();
					comSession = null;
				}
			}
			catch(e){
				onError(e);
			}
			finally{
				node.isConnected = false;
				await serverStatusChanged('disconnected');
				node.busy = false;
			}
		}
		
		async function serverStatusChanged(status){
			for(entry of groupNodes.entries()){
				await entry[1].serverStatusChanged(status);
			}
		}
		
		node.registerGroupNode = function registerGroupNode(groupNode){
			groupNodes.set(groupNode.config.id, groupNode);
		}
		
		node.removeGroupNode = function removeGroupNode(groupNode){
			groupNodes.delete(groupNode.config.id);
		}
		
		//reconnect server
		let reconnecting = false;
		node.reconnect = async function reconnect(){
			if(!reconnecting){
				reconnecting = true;
				await new Promise(resolve => setTimeout(resolve, 1000));
				await destroy();
				await init();
				reconnecting = false;
			}
		}
		
		async function onError(e){
			var msg = errorMessage(e);
			node.error(msg);
			await serverStatusChanged('error');

			switch(e) {
				case 0x00000005:
                case 0xC0040010:
                case 0x80040154:
                case 0x00000061:
					return;
                default:
                    await node.reconnect().catch(onError);
            }
		}
					
		function errorMessage(e){
			var msg = errorCode[e] ? errorCode[e] : e.message;
			return msg;
		}
		
		node.on('close', function(){
			destroy();
			done();
		});
	}
	
    RED.nodes.registerType("opcda-server", OPCDAServer, {
		credentials: {
			username: {type:"text"},
			password: {type:"password"}
		}
    });
}
