module.exports = function(RED) {
	const opcda = require('node-opc-da');
    const { OPCGroupStateManager, OPCItemManager, OPCSyncIO, OPCServer } = opcda;
    const { ComServer, Session, Clsid } = opcda.dcom;
	
    function OPCDAServer(config) {
        RED.nodes.createNode(this,config);
        const node = this;
		
		let comServer, opcServer;
		
	
		if (!node.credentials) {
            return node.error("Failed to load credentials!");
        }
				
	
		statusChanged('unknown');

		init().catch(onError);
		
		async function init(){
			let comSession = new Session();
            comSession = comSession.createSession(config.domain, node.credentials.username, node.credentials.password);
            comSession.setGlobalSocketTimeout(config.timeout);
			
			comServer = new ComServer(new Clsid(config.clsid), config.address, comSession);	
			let comObject = await comServer.createInstance();
			
			statusChanged('connected');
			
			comServer.on("disconnected", function(){
                statusChanged("disconnected");
            });
		
		}
				
		function destroy(){
		
		}
		
		function statusChanged(status){
			console.log(status);
		}
		
		function onError(e){
			console.log(e.message);
		}
	}
	
    RED.nodes.registerType("opcda-server", OPCDAServer, {
		credentials: {
			username: {type:"text"},
			password: {type:"password"}
		}
    });
}
