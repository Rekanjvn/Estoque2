import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, query, orderBy, onSnapshot, doc, setDoc, addDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, where, limit } from 'firebase/firestore';

// --- Variáveis Globais do Ambiente Canvas (Não Modificar) ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Funções utilitárias
const toCSV = (data) => {
    if (data.length === 0) return '';
    const headers = Object.keys(data[0]).filter(key => key !== 'id' && key !== 'history');
    const csvRows = [
        headers.join(';'),
        ...data.map(row => headers.map(header => {
            const value = row[header];
            if (value instanceof Date) return value.toISOString();
            if (typeof value === 'string' && (value.includes(';') || value.includes('"') || value.includes('\n'))) {
                return `"${value.replace(/"/g, '""')}"`;
            }
            return value;
        }).join(';'))
    ];
    return csvRows.join('\n');
};

// Funções de Ícones (Lucide-React ou Inline SVG)
const PlusIcon = (props) => (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
);
const SearchIcon = (props) => (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
);
const DownloadIcon = (props) => (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
);
const SendIcon = (props) => (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
);
const UsersIcon = (props) => (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
);

const SectionTitle = ({ children }) => (
    <h2 className="text-xl font-bold text-gray-800 mb-4 border-b pb-2 border-indigo-100">{children}</h2>
);

// Componente principal
const App = () => {
    // --- 1. ESTADO DE AUTENTICAÇÃO E FIREBASE ---
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [error, setError] = useState('');
    const [activeTab, setActiveTab] = useState('inventory'); // 'inventory', 'chat', 'reports'

    // --- 2. ESTADO DE DADOS ---
    const [sheets, setSheets] = useState([]);
    const [chatMessages, setChatMessages] = useState([]);
    const [movements, setMovements] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');

    // --- 3. ESTADO DE FORMULÁRIOS / MODELAGEM ---
    const [newSheet, setNewSheet] = useState({
        type: '',
        thickness: '',
        size: '',
        location: '',
        initialQuantity: '',
    });
    const [chatInput, setChatInput] = useState('');
    const [adjustment, setAdjustment] = useState({ id: null, type: '', quantity: 0, movementType: 'OUTPUT', notes: '' });
    const chatRef = useRef(null);

    // Nome de usuário simples para identificação
    const userName = useMemo(() => userId ? `Usuário ${userId.substring(0, 4)}` : 'Convidado', [userId]);

    // Função de rolagem para o final do chat
    useEffect(() => {
        if (chatRef.current) {
            chatRef.current.scrollTop = chatRef.current.scrollHeight;
        }
    }, [chatMessages]);

    // Inicialização do Firebase
    useEffect(() => {
        if (Object.keys(firebaseConfig).length > 0) {
            try {
                const app = initializeApp(firebaseConfig);
                const firestore = getFirestore(app);
                const authentication = getAuth(app);
                setDb(firestore);
                setAuth(authentication);

                const unsubscribe = onAuthStateChanged(authentication, async (user) => {
                    if (user) {
                        setUserId(user.uid);
                    } else {
                        // Tenta autenticar com token customizado se disponível, senão anonimamente
                        if (initialAuthToken) {
                            await signInWithCustomToken(authentication, initialAuthToken).catch(e => {
                                console.error("Erro ao autenticar com token customizado, logando anonimamente.", e);
                                signInAnonymously(authentication);
                            });
                        } else {
                            await signInAnonymously(authentication);
                        }
                    }
                    setIsAuthReady(true);
                });
                return () => unsubscribe();
            } catch (e) {
                console.error("Erro ao inicializar Firebase:", e);
                setError("Erro de inicialização do Firebase. Verifique a configuração.");
            }
        } else {
            setError("Configuração do Firebase não encontrada. O sistema não salvará dados.");
        }
    }, []);

    // Escutas de Dados (onSnapshot)
    useEffect(() => {
        if (!db || !isAuthReady) return;

        const baseCollectionPath = `/artifacts/${appId}/public/data`;
        const sheetsColRef = collection(db, `${baseCollectionPath}/acrylic_sheets`);
        const chatColRef = collection(db, `${baseCollectionPath}/material_chat`);
        const movementsColRef = collection(db, `${baseCollectionPath}/sheet_movements`);

        // Escuta para o Inventário de Chapas
        const unsubscribeSheets = onSnapshot(sheetsColRef, (snapshot) => {
            const sheetList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setSheets(sheetList);
        }, (err) => console.error("Erro ao buscar chapas:", err));

        // Escuta para o Chat
        const chatQuery = query(chatColRef, orderBy('timestamp', 'asc'), limit(50));
        const unsubscribeChat = onSnapshot(chatQuery, (snapshot) => {
            const messages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setChatMessages(messages);
        }, (err) => console.error("Erro ao buscar chat:", err));

        // Escuta para os Movimentos
        const movementsQuery = query(movementsColRef, orderBy('timestamp', 'desc'));
        const unsubscribeMovements = onSnapshot(movementsQuery, (snapshot) => {
            const movementList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setMovements(movementList);
        }, (err) => console.error("Erro ao buscar movimentos:", err));

        return () => {
            unsubscribeSheets();
            unsubscribeChat();
            unsubscribeMovements();
        };
    }, [db, isAuthReady]);


    // --- 4. LÓGICA DE NEGÓCIO (CRUD) ---

    // Adicionar Nova Chapa / Adicionar a Existente
    const handleAddOrUpdateSheet = async (e) => {
        e.preventDefault();
        if (!db || !userId) return;

        const { type, thickness, size, location, initialQuantity } = newSheet;
        const quantity = parseInt(initialQuantity);
        const thicknessNum = parseFloat(thickness);

        if (!type || !thicknessNum || !size || !location || quantity <= 0) {
            alert('Preencha todos os campos corretamente e defina uma quantidade inicial positiva.');
            return;
        }

        const sheetsColRef = collection(db, `/artifacts/${appId}/public/data/acrylic_sheets`);
        const movementsColRef = collection(db, `/artifacts/${appId}/public/data/sheet_movements`);

        const existingSheet = sheets.find(s => s.type === type && s.thickness === thicknessNum && s.size === size);

        try {
            if (existingSheet) {
                // Atualizar Chapa Existente
                const sheetDocRef = doc(db, sheetsColRef.path, existingSheet.id);
                await updateDoc(sheetDocRef, {
                    quantity: existingSheet.quantity + quantity,
                    lastIn: serverTimestamp(),
                });
                
                // Registrar Movimento de Entrada
                await addDoc(movementsColRef, {
                    sheetId: existingSheet.id,
                    type: 'INPUT',
                    quantity: quantity,
                    timestamp: serverTimestamp(),
                    userId: userId,
                    userName: userName,
                    sheetInfo: { type, thickness: thicknessNum, size },
                });

            } else {
                // Adicionar Nova Chapa
                await addDoc(sheetsColRef, {
                    type,
                    thickness: thicknessNum,
                    size,
                    location,
                    quantity,
                    lastIn: serverTimestamp(),
                    createdAt: serverTimestamp(),
                });

            }
            // Limpar formulário
            setNewSheet({ type: '', thickness: '', size: '', location: '', initialQuantity: '' });
        } catch (e) {
            console.error("Erro ao adicionar/atualizar chapa:", e);
            alert("Erro ao salvar dados. Verifique o console.");
        }
    };

    // Ajuste de Estoque (Saída/Entrada)
    const handleAdjustment = async () => {
        if (!db || !userId || !adjustment.id || adjustment.quantity <= 0) return;

        const sheetToAdjust = sheets.find(s => s.id === adjustment.id);
        if (!sheetToAdjust) return;

        const sheetsColRef = collection(db, `/artifacts/${appId}/public/data/acrylic_sheets`);
        const movementsColRef = collection(db, `/artifacts/${appId}/public/data/sheet_movements`);
        const sheetDocRef = doc(db, sheetsColRef.path, sheetToAdjust.id);

        let newQuantity = sheetToAdjust.quantity;
        let movementType = adjustment.movementType;

        if (movementType === 'OUTPUT') {
            if (sheetToAdjust.quantity < adjustment.quantity) {
                alert('A quantidade de saída é maior que o estoque atual.');
                return;
            }
            newQuantity -= adjustment.quantity;
        } else {
            newQuantity += adjustment.quantity;
        }

        try {
            // 1. Atualizar a Chapa
            await updateDoc(sheetDocRef, {
                quantity: newQuantity,
                ...(movementType === 'OUTPUT' ? { lastOut: serverTimestamp() } : { lastIn: serverTimestamp() }),
            });

            // 2. Registrar Movimento
            await addDoc(movementsColRef, {
                sheetId: sheetToAdjust.id,
                type: movementType,
                quantity: adjustment.quantity,
                timestamp: serverTimestamp(),
                userId: userId,
                userName: userName,
                sheetInfo: { type: sheetToAdjust.type, thickness: sheetToAdjust.thickness, size: sheetToAdjust.size },
                notes: adjustment.notes,
            });

            // 3. Limpar
            setAdjustment({ id: null, type: '', quantity: 0, movementType: 'OUTPUT', notes: '' });
        } catch (e) {
            console.error("Erro ao ajustar estoque:", e);
            alert("Erro ao ajustar estoque. Verifique o console.");
        }
    };

    // Enviar Mensagem do Chat
    const handleSendChat = async (e) => {
        e.preventDefault();
        if (!db || !userId || !chatInput.trim()) return;

        const chatColRef = collection(db, `/artifacts/${appId}/public/data/material_chat`);

        try {
            await addDoc(chatColRef, {
                userId: userId,
                username: userName,
                message: chatInput,
                timestamp: serverTimestamp(),
            });
            setChatInput('');
        } catch (e) {
            console.error("Erro ao enviar mensagem:", e);
        }
    };

    // Lógica de Busca (Filtro)
    const filteredSheets = useMemo(() => {
        if (!searchTerm) return sheets;
        const lowerCaseSearch = searchTerm.toLowerCase();
        return sheets.filter(sheet =>
            sheet.type.toLowerCase().includes(lowerCaseSearch) ||
            sheet.size.toLowerCase().includes(lowerCaseSearch) ||
            sheet.location.toLowerCase().includes(lowerCaseSearch) ||
            String(sheet.thickness).includes(lowerCaseSearch)
        );
    }, [sheets, searchTerm]);

    // Lógica de Exportação CSV
    const handleExportCSV = () => {
        const dataToExport = sheets.map(s => ({
            ID: s.id,
            TIPO: s.type,
            ESPESSURA_MM: s.thickness,
            TAMANHO: s.size,
            LOCALIZACAO: s.location,
            QUANTIDADE: s.quantity,
            ULTIMA_ENTRADA: s.lastIn ? new Date(s.lastIn.seconds * 1000) : '',
        }));

        const csvString = toCSV(dataToExport);
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `estoque_acrilico_${new Date().toISOString().slice(0, 10)}.csv`);
        link.click();
        URL.revokeObjectURL(url);
    };

    // Lógica de Relatórios Mensais
    const generateMonthlyReport = useMemo(() => {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();

        const monthlyData = movements.reduce((acc, movement) => {
            if (!movement.timestamp) return acc;

            const date = new Date(movement.timestamp.seconds * 1000);
            if (date.getFullYear() === currentYear && date.getMonth() === currentMonth) {
                const key = `${date.getFullYear()}-${date.getMonth()}`;
                if (!acc[key]) {
                    acc[key] = { entradas: 0, saidas: 0 };
                }

                if (movement.type === 'INPUT') {
                    acc[key].entradas += movement.quantity;
                } else if (movement.type === 'OUTPUT') {
                    acc[key].saidas += movement.quantity;
                }
            }
            return acc;
        }, {});

        const report = monthlyData[`${currentYear}-${currentMonth}`] || { entradas: 0, saidas: 0 };
        return report;
    }, [movements]);

    // --- 5. COMPONENTES DE RENDERIZAÇÃO ---

    const RenderInventory = () => (
        <div className="p-4 md:p-6 bg-white rounded-xl shadow-lg h-full flex flex-col">
            <SectionTitle>Gerenciamento de Estoque de Chapas</SectionTitle>

            {/* Adicionar Nova Chapa / Adicionar a Existente */}
            <form onSubmit={handleAddOrUpdateSheet} className="grid grid-cols-2 md:grid-cols-6 gap-3 p-4 bg-indigo-50 rounded-lg mb-6 shadow-inner">
                <input type="text" placeholder="Tipo (Ex: Transparente)" value={newSheet.type} onChange={e => setNewSheet({...newSheet, type: e.target.value})} className="col-span-2 p-2 border rounded-lg focus:ring-indigo-500 focus:border-indigo-500" required />
                <input type="number" step="0.1" placeholder="Espessura (mm)" value={newSheet.thickness} onChange={e => setNewSheet({...newSheet, thickness: e.target.value})} className="p-2 border rounded-lg focus:ring-indigo-500 focus:border-indigo-500" required />
                <input type="text" placeholder="Tamanho (Ex: 1220x2440)" value={newSheet.size} onChange={e => setNewSheet({...newSheet, size: e.target.value})} className="col-span-1 md:col-span-2 p-2 border rounded-lg focus:ring-indigo-500 focus:border-indigo-500" required />
                <input type="text" placeholder="Localização" value={newSheet.location} onChange={e => setNewSheet({...newSheet, location: e.target.value})} className="col-span-1 p-2 border rounded-lg focus:ring-indigo-500 focus:border-indigo-500" required />
                <input type="number" placeholder="Qtd Inicial" value={newSheet.initialQuantity} onChange={e => setNewSheet({...newSheet, initialQuantity: e.target.value})} className="p-2 border rounded-lg focus:ring-indigo-500 focus:border-indigo-500" required />
                <button type="submit" className="col-span-2 md:col-span-6 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 rounded-lg transition duration-200 flex items-center justify-center">
                    <PlusIcon className="w-5 h-5 mr-2" /> Adicionar/Entrada de Material
                </button>
            </form>

            {/* Pesquisa e Exportação */}
            <div className="flex flex-col sm:flex-row gap-3 mb-6">
                <div className="relative flex-grow">
                    <input
                        type="text"
                        placeholder="Pesquisar por Tipo, Espessura, Tamanho ou Localização..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="w-full p-3 pl-10 border border-gray-300 rounded-xl focus:ring-indigo-500 focus:border-indigo-500 shadow-sm"
                    />
                    <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                </div>
                <button
                    onClick={handleExportCSV}
                    className="flex-shrink-0 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold py-3 px-4 rounded-xl transition duration-200 shadow-md flex items-center justify-center"
                >
                    <DownloadIcon className="w-5 h-5 mr-2" /> Exportar CSV
                </button>
            </div>

            {/* Tabela de Estoque */}
            <div className="overflow-x-auto rounded-xl shadow-lg flex-grow">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-indigo-50 sticky top-0">
                        <tr>
                            {['Tipo', 'Espessura (mm)', 'Tamanho', 'Localização', 'Estoque', 'Ajuste'].map(header => (
                                <th key={header} className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">{header}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {filteredSheets.length === 0 ? (
                            <tr><td colSpan="6" className="px-6 py-4 text-center text-gray-500">Nenhuma chapa encontrada.</td></tr>
                        ) : (
                            filteredSheets.map(sheet => (
                                <tr key={sheet.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{sheet.type}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{sheet.thickness}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{sheet.size}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{sheet.location}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-indigo-600">{sheet.quantity}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                        <button
                                            onClick={() => setAdjustment({ id: sheet.id, type: sheet.type, quantity: 1, movementType: 'OUTPUT', notes: '' })}
                                            className="text-indigo-600 hover:text-indigo-900 font-semibold text-sm"
                                        >
                                            Ajustar Qtd
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Modal de Ajuste de Estoque */}
            {adjustment.id && (
                <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex justify-center items-center z-50 p-4">
                    <div className="bg-white p-6 rounded-xl shadow-2xl w-full max-w-md">
                        <h3 className="text-lg font-bold mb-4">Ajustar Estoque de: {adjustment.type}</h3>
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-gray-700">Tipo de Movimento</label>
                            <select
                                value={adjustment.movementType}
                                onChange={e => setAdjustment({...adjustment, movementType: e.target.value})}
                                className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
                            >
                                <option value="OUTPUT">Saída (Retirada)</option>
                                <option value="INPUT">Entrada (Adição)</option>
                            </select>
                        </div>
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-gray-700">Quantidade</label>
                            <input
                                type="number"
                                min="1"
                                value={adjustment.quantity}
                                onChange={e => setAdjustment({...adjustment, quantity: parseInt(e.target.value) || 0})}
                                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500"
                            />
                        </div>
                        <div className="mb-6">
                            <label className="block text-sm font-medium text-gray-700">Observações (Opcional)</label>
                            <textarea
                                value={adjustment.notes}
                                onChange={e => setAdjustment({...adjustment, notes: e.target.value})}
                                rows="2"
                                placeholder="Motivo da saída/entrada, projeto, etc."
                                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500"
                            />
                        </div>
                        <div className="flex justify-end space-x-3">
                            <button
                                onClick={() => setAdjustment({ id: null, type: '', quantity: 0, movementType: 'OUTPUT', notes: '' })}
                                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleAdjustment}
                                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 transition"
                            >
                                Confirmar Ajuste
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );

    const RenderChat = () => (
        <div className="p-4 md:p-6 bg-white rounded-xl shadow-lg h-full flex flex-col">
            <SectionTitle>Chat de Solicitação e Comunicação</SectionTitle>
            <div ref={chatRef} className="flex-grow overflow-y-auto space-y-4 p-3 mb-4 border border-gray-200 rounded-lg bg-gray-50 h-[300px] max-h-[calc(100vh-350px)]">
                {chatMessages.length === 0 ? (
                    <p className="text-center text-gray-500 italic">Inicie a conversa! Use este chat para solicitar material ou tirar dúvidas.</p>
                ) : (
                    chatMessages.map((msg) => {
                        const isMine = msg.userId === userId;
                        const time = msg.timestamp ? new Date(msg.timestamp.seconds * 1000).toLocaleTimeString('pt-BR').substring(0, 5) : '...';
                        return (
                            <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-xs md:max-w-md px-4 py-2 rounded-xl shadow ${isMine ? 'bg-indigo-500 text-white rounded-br-none' : 'bg-gray-200 text-gray-800 rounded-tl-none'}`}>
                                    {!isMine && <div className="text-xs font-semibold mb-1 opacity-80">{msg.username}</div>}
                                    <p className="text-sm">{msg.message}</p>
                                    <span className={`block text-right text-xs mt-1 ${isMine ? 'opacity-70' : 'text-gray-500'}`}>{time}</span>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
            <form onSubmit={handleSendChat} className="flex gap-2">
                <input
                    type="text"
                    placeholder="Digite sua mensagem ou solicitação..."
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    className="flex-grow p-3 border border-gray-300 rounded-xl focus:ring-indigo-500 focus:border-indigo-500 shadow-sm"
                    required
                />
                <button
                    type="submit"
                    className="flex-shrink-0 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-4 rounded-xl transition duration-200 flex items-center justify-center"
                    disabled={!chatInput.trim()}
                >
                    <SendIcon className="w-5 h-5" />
                </button>
            </form>
        </div>
    );

    const RenderReports = () => (
        <div className="p-4 md:p-6 bg-white rounded-xl shadow-lg h-full flex flex-col">
            <SectionTitle>Relatórios Mensais de Movimentação</SectionTitle>

            <div className="mb-6">
                <h3 className="text-xl font-semibold text-indigo-700 mb-2">Resumo Mensal (Mês Atual)</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-green-50 p-4 rounded-xl shadow-md border-l-4 border-green-500">
                        <p className="text-sm font-medium text-gray-500">Total de Entradas</p>
                        <p className="text-2xl font-bold text-green-600">{generateMonthlyReport.entradas} chapas</p>
                    </div>
                    <div className="bg-red-50 p-4 rounded-xl shadow-md border-l-4 border-red-500">
                        <p className="text-sm font-medium text-gray-500">Total de Saídas</p>
                        <p className="text-2xl font-bold text-red-600">{generateMonthlyReport.saidas} chapas</p>
                    </div>
                    <div className="bg-blue-50 p-4 rounded-xl shadow-md border-l-4 border-blue-500">
                        <p className="text-sm font-medium text-gray-500">Estoque Total</p>
                        <p className="text-2xl font-bold text-blue-600">{sheets.reduce((sum, s) => sum + s.quantity, 0)} chapas</p>
                    </div>
                </div>
            </div>

            <h3 className="text-lg font-semibold text-gray-800 mb-3">Histórico Detalhado de Movimentos</h3>
            <div className="overflow-y-auto max-h-[calc(100vh-350px)] flex-grow">
                <div className="space-y-3">
                    {movements.length === 0 ? (
                        <p className="text-center text-gray-500 italic py-4">Nenhum movimento registrado este mês.</p>
                    ) : (
                        movements.map(m => {
                            const date = m.timestamp ? new Date(m.timestamp.seconds * 1000).toLocaleString('pt-BR') : 'N/A';
                            const isInput = m.type === 'INPUT';
                            return (
                                <div key={m.id} className={`p-3 rounded-lg shadow-sm border ${isInput ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'} flex justify-between items-center`}>
                                    <div>
                                        <p className="font-semibold text-sm">
                                            {isInput ? 'ENTRADA' : 'SAÍDA'} de <span className="text-base">{m.quantity}</span> chapas
                                        </p>
                                        <p className="text-xs text-gray-600">
                                            {m.sheetInfo.type}, {m.sheetInfo.thickness}mm, {m.sheetInfo.size}
                                        </p>
                                        {m.notes && <p className="text-xs italic text-gray-500 mt-1">Obs: {m.notes}</p>}
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs text-gray-700">{date}</p>
                                        <p className="text-xs text-gray-500">Por: {m.userName}</p>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

        </div>
    );

    // --- 6. RENDERIZAÇÃO PRINCIPAL ---

    return (
        <div className="min-h-screen bg-gray-100 font-sans p-2 sm:p-4 md:p-6">
            <script src="https://cdn.tailwindcss.com"></script>
            <style>{`
                /* Font Inter is assumed to be available */
                .font-sans { font-family: 'Inter', sans-serif; }
                /* Custom styles for mobile responsiveness */
                .tab-content {
                    min-height: calc(100vh - 150px); /* Ajuste para o header e footer */
                }
                @media (min-width: 768px) {
                     .tab-content {
                        min-height: calc(100vh - 48px);
                    }
                }
            `}</style>
            <div className="max-w-6xl mx-auto">
                {/* Cabeçalho */}
                <header className="bg-indigo-700 text-white p-4 rounded-xl shadow-xl mb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center">
                    <h1 className="text-2xl font-extrabold mb-2 sm:mb-0">Gestão de Estoque Acrílico</h1>
                    <div className="text-right bg-indigo-800 px-3 py-1 rounded-full text-sm font-medium flex items-center">
                        <UsersIcon className="w-4 h-4 mr-2" />
                        ID do Usuário: <span className="font-mono ml-2">{userName}</span>
                    </div>
                </header>

                {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">{error}</div>}

                {/* Navegação por Abas (Responsiva) */}
                <div className="flex justify-around bg-white p-2 rounded-xl shadow-md mb-4 sticky top-0 z-10">
                    <button
                        onClick={() => setActiveTab('inventory')}
                        className={`py-2 px-4 rounded-lg font-semibold transition duration-200 w-1/3 ${activeTab === 'inventory' ? 'bg-indigo-500 text-white shadow-lg' : 'text-gray-600 hover:bg-gray-100'}`}
                    >
                        Estoque
                    </button>
                    <button
                        onClick={() => setActiveTab('chat')}
                        className={`py-2 px-4 rounded-lg font-semibold transition duration-200 w-1/3 ${activeTab === 'chat' ? 'bg-indigo-500 text-white shadow-lg' : 'text-gray-600 hover:bg-gray-100'}`}
                    >
                        Chat
                    </button>
                    <button
                        onClick={() => setActiveTab('reports')}
                        className={`py-2 px-4 rounded-lg font-semibold transition duration-200 w-1/3 ${activeTab === 'reports' ? 'bg-indigo-500 text-white shadow-lg' : 'text-gray-600 hover:bg-gray-100'}`}
                    >
                        Relatórios
                    </button>
                </div>

                {/* Conteúdo da Aba */}
                <main className="tab-content">
                    {activeTab === 'inventory' && RenderInventory()}
                    {activeTab === 'chat' && RenderChat()}
                    {activeTab === 'reports' && RenderReports()}
                </main>
            </div>
        </div>
    );
};

export default App;