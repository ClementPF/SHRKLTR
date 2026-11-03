package calc.service;

import calc.DTO.*;
import calc.entity.*;
import calc.exception.APIException;
import calc.repository.GameRepository;
import calc.repository.SportRepository;
import calc.repository.TournamentRepository;
import calc.repository.UserRepository;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.test.context.TestExecutionListeners;
import org.springframework.test.context.junit4.SpringRunner;
import org.springframework.test.context.support.DependencyInjectionTestExecutionListener;
import org.springframework.test.context.support.DirtiesContextTestExecutionListener;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;


@SpringBootTest
//@PropertySource(value = {"classpath:application.properties", "${api.config.location}"}, ignoreResourceNotFound = true)
@TestExecutionListeners(inheritListeners = false, listeners = {
        DependencyInjectionTestExecutionListener.class,
        DirtiesContextTestExecutionListener.class
})
@RunWith(SpringRunner.class)
public class GameServiceTest {

    private static final Logger LOG = LoggerFactory.getLogger(GameServiceTest.class);

    @Autowired
    private GameService gameService;
    @Autowired
    private UserService userService;
    @Autowired
    private UserRepository userRepository;
    @Autowired
    private TournamentService tournamentService;

    @Autowired
    private SportRepository sportRepository;
    @Autowired
    private GameRepository gameRepository;
    @Autowired
    private TournamentRepository tournamentRepository;

    UserServiceTest userServiceTest;
    TournamentServiceTest tournamentServiceTest;

    List<GameDTO> allGames ;
    User u1;
    User u2;
    User u3;
    User u4;
    User u5;
    User u6;

    Tournament t1;

    @Before
    public void setUp() {
        userServiceTest = new UserServiceTest();
        tournamentServiceTest = new TournamentServiceTest();

        Sport sport1 = sportRepository.save(new Sport(UUID.randomUUID().toString()));

        u1 = userRepository.save(userServiceTest.makeRandomUser());
        u2 = userRepository.save(userServiceTest.makeRandomUser());
        u3 = userRepository.save(userServiceTest.makeRandomUser());
        u4 = userRepository.save(userServiceTest.makeRandomUser());
        u5 = userRepository.save(userServiceTest.makeRandomUser());
        u6 = userRepository.save(userServiceTest.makeRandomUser());


        t1 = tournamentRepository.save(tournamentServiceTest.makeRandomTournament(sport1, u1));

        //allGames.add(gameService.save(game));
    }

    //@Test
    public void findOne(){
        GameDTO gTest = allGames.get(new Random().nextInt(allGames.size() - 1));
        GameDTO gFetch = gameService.findOne(gTest.getGameId());
        assertThat(gTest).isEqualToComparingFieldByField(gFetch);
    }

    @Test
    public void addGame() {

    }

    @Test
    public void findByTournament(){

    }

    @Test
    public void findByTournamentName(){

        Sport sport = sportRepository.save(new SportServiceTest().makeRandomSport());
        Tournament tournament = tournamentRepository.save(tournamentServiceTest.makeRandomTournament(sport,u1));

        int size = 30;
        for(int i = 0; i < size; i++){
            gameRepository.save(makeRandomGame(u1,u2,tournament));
        }


        List<Game> games3 = gameRepository.findByOutcomesUserUserId(u1.getUserId(), null);
        assertThat(games3).isNotNull();
        List<Game> games = gameRepository.findByTournamentName(tournament.getName(),null);
//        List<GameDTO> games2 = gameService.findByTournamentName(tournament.getName());

        assertThat(games).isNotNull();
        // assertThat(games2.size()).isEqualTo(30);
        assertThat(games.size()).isEqualTo(30);
        assertThat(games).hasSize(30);
    }

    @Test
    public void findByUserName(){

        Sport sport = sportRepository.save(new SportServiceTest().makeRandomSport());
        Tournament tournament = tournamentRepository.save(tournamentServiceTest.makeRandomTournament(sport,u1));

        int size = 30;
        for(int i = 0; i < size; i++){
            gameRepository.save(makeRandomGame(u1,u2,tournament));
        }


        List<Game> games3 = gameRepository.findByOutcomesUserUserId(u1.getUserId(), null);
        assertThat(games3).isNotNull();
        List<Game> gamesPage0 = gameRepository.findByOutcomesUserUserNameOrderByDateDesc(u1.getUserName(),new PageRequest(0,size/2));
        List<Game> gamesPage1 = gameRepository.findByOutcomesUserUserNameOrderByDateDesc(u1.getUserName(),new PageRequest(1,size/2));
    //        List<GameDTO> games2 = gameService.findByTournamentName(tournament.getName());

        assertThat(gamesPage0).isNotNull();
        assertThat(gamesPage1).isNotNull();
        assertThat(games3.size()).isEqualTo(30);
        assertThat(gamesPage0.size()).isEqualTo(15);
        assertThat(gamesPage1.size()).isEqualTo(15);
        assertThat(gamesPage0.get(0).getGameId()).isNotEqualTo(gamesPage1.get(0).getGameId());
    }

    @Test
    public void findByOutcomeUserUserIdByTournamentTournamentId(){
        Sport sport = sportRepository.save(new SportServiceTest().makeRandomSport());
        User u = userRepository.save(userServiceTest.makeRandomUser());
        Tournament tournament = tournamentRepository.save(tournamentServiceTest.makeRandomTournament(sport,u));

        int size = 5;
        for(int i = 0; i < size; i++){
            gameRepository.save(makeRandomGame(u,u2,tournament));
        }

        List<Game> games = gameRepository.findByOutcomesUserUserIdAndTournamentTournamentId(u.getUserId(), tournament.getTournamentId(), null);
        assertThat(games).isNotNull();
        assertThat(games).hasSize(size);
    }


    @Test
    public void findByOutcomeUserUserIdByTournamentTournamentId2(){
        Sport sport = sportRepository.save(new SportServiceTest().makeRandomSport());
        User u = userRepository.save(userServiceTest.makeRandomUser());
        Tournament tournament = tournamentRepository.save(tournamentServiceTest.makeRandomTournament(sport,u));


        int halfSize = 15;
        int size = halfSize*2;
        for(int i = 0; i < size; i++){
            gameRepository.save(makeRandomGame(u,u2,tournament));
        }

        List<Game> games = gameRepository.findByOutcomesUserUserIdAndTournamentTournamentId(u.getUserId(), tournament.getTournamentId(), new PageRequest(0, halfSize));
        assertThat(games).isNotNull();
        assertThat(games).hasSize(halfSize);
        games.addAll(gameRepository.findByOutcomesUserUserIdAndTournamentTournamentId(u.getUserId(), tournament.getTournamentId(), new PageRequest(1, halfSize)));
        assertThat(games).isNotNull();
        assertThat(games).hasSize(size);
    }

    @Test
    public void perf(){
        Sport sport = sportRepository.save(new SportServiceTest().makeRandomSport());
        User u = userRepository.save(userServiceTest.makeRandomUser());
        Tournament tournament = tournamentRepository.save(tournamentServiceTest.makeRandomTournament(sport,u));


        int halfSize = 5000;
        int size = halfSize*2;
        for(int i = 0; i < size; i++){
            gameRepository.save(makeRandomGame(u,u2,tournament));
        }

        long time = System.currentTimeMillis();

        Pageable p = new PageRequest(0,100);
        gameRepository.findByOutcomesUserUserIdAndTournamentTournamentId(u.getUserId(), tournament.getTournamentId(), p);

        time = System.currentTimeMillis() - time;
        System.out.print("TIME FOR a page " + time + "\n");

        time = System.currentTimeMillis();
        List<Game> games= gameRepository.findByOutcomesUserUserIdAndTournamentTournamentId(u.getUserId(), tournament.getTournamentId(), null);

        time = System.currentTimeMillis() - time;
        System.out.print("TIME FOR a full fetch " + time + " ms for " + games.size() +  "\n");

        time = System.currentTimeMillis();
        Integer gameCount = gameRepository.countByTournament(tournament);

        time = System.currentTimeMillis() - time;
        System.out.print("TIME TO count all " + time + " ms for " + gameCount + "\n");
    }

    @Test
    public void findByUserUsernameByTournamentTournamentName(){
        Sport sport = sportRepository.save(new SportServiceTest().makeRandomSport());
        User u = userRepository.save(userServiceTest.makeRandomUser());
        Tournament tournament = tournamentRepository.save(tournamentServiceTest.makeRandomTournament(sport,u));

        int size = 5;
        for(int i = 0; i < size; i++){
            gameRepository.save(makeRandomGame(u,u2,tournament));
        }

        List<Game> games = gameRepository.findByOutcomesUserUserNameAndTournamentNameOrderByDateDesc(u.getUserName(), tournament.getName(), null);
        assertThat(games).isNotNull();
        assertThat(games).hasSize(size);
    }


    @Test
    public void findByOutcomeUser() {
        Sport sport = sportRepository.save(new SportServiceTest().makeRandomSport());
        User u = userRepository.save(userServiceTest.makeRandomUser());
        Tournament tournament = tournamentRepository.save(tournamentServiceTest.makeRandomTournament(sport,u));

        int size = 5;
        for(int i = 0; i < size; i++){
            gameRepository.save(makeRandomGame(u,u2,tournament));
        }

        List<Game> games = gameRepository.findByOutcomesUserOrderByDateDesc(u, null);
        assertThat(games).isNotNull();
        assertThat(games).hasSize(size);
    }

    @Test
    public void findByOutcomeUserUserName() {
        Sport sport = sportRepository.save(new SportServiceTest().makeRandomSport());
        User u = userRepository.save(userServiceTest.makeRandomUser());
        Tournament tournament = tournamentRepository.save(tournamentServiceTest.makeRandomTournament(sport,u));

        int size = 5;
        for(int i = 0; i < size; i++){
            gameRepository.save(makeRandomGame(u,u2,tournament));
        }

        List<Game> games = gameRepository.findByOutcomesUserUserName(u.getUserName(), null);
        assertThat(games).isNotNull();
        assertThat(games).hasSize(size);
    }

    @Test
    public void save(){
    }

    @Test
    public void validateGame_whenLooserLoggedIn() {

        UserDTO winner = userServiceTest.makeRandomUserDTO();
        UserDTO looser = userServiceTest.makeRandomUserDTO();

        TournamentDTO tournamentDTO = tournamentServiceTest.makeRandomTournamentDTO(new SportDTO("sport"),userServiceTest.makeRandomUserDTO());
        GameDTO gameDTO = makeRandomGameDTO(winner,looser,tournamentDTO);
        gameService.validateGame(winner,looser,looser,tournamentDTO,gameDTO);
    }

    @Test
    public void validateGame_1vs1_success() {

        UserDTO winner1 = userService.findOne(u1.getUserId());
        UserDTO looser1 = userService.findOne(u3.getUserId());

        TournamentDTO tournamentDTO = tournamentService.findOne(t1.getTournamentId());

        List<UserDTO> winners = new ArrayList<>();
        winners.add(winner1);
        List<UserDTO> losers = new ArrayList<>();
        losers.add(looser1);

        GameDTO gameDTO = makeRandomGameDTO(winners,losers,tournamentDTO);
        gameService.validateGame(looser1, gameDTO);
    }

    @Test(expected = APIException.class)
    public void validateGame_1vs1_failure_1() {

        UserDTO winner1 = userService.findOne(u1.getUserId());
        UserDTO looser1 = userService.findOne(u3.getUserId());

        TournamentDTO tournamentDTO = tournamentService.findOne(t1.getTournamentId());

        List<UserDTO> winners = new ArrayList<>();
        winners.add(winner1);
        List<UserDTO> losers = new ArrayList<>();
        losers.add(winner1);

        GameDTO gameDTO = makeRandomGameDTO(winners,losers,tournamentDTO);
        try{
            gameService.validateGame(looser1, gameDTO);
        }catch ( APIException e){
            LOG.debug(e.toString());
            throw e;
        }
    }

    @Test(expected = APIException.class)
    public void validateGame_1vs1_failure_2() {

        UserDTO winner1 = userService.findOne(u1.getUserId());
        UserDTO looser1 = userService.findOne(u3.getUserId());

        TournamentDTO tournamentDTO = tournamentService.findOne(t1.getTournamentId());

        List<UserDTO> winners = new ArrayList<>();
        winners.add(looser1);
        List<UserDTO> losers = new ArrayList<>();
        losers.add(looser1);

        GameDTO gameDTO = makeRandomGameDTO(winners,losers,tournamentDTO);
        try{
            gameService.validateGame(looser1, gameDTO);
        }catch ( APIException e){
            LOG.debug(e.toString());
            throw e;
        }
    }

    @Test(expected = APIException.class)
    public void validateGame_1vs1_failure_3() {

        UserDTO winner1 = userService.findOne(u1.getUserId());
        UserDTO looser1 = userService.findOne(u3.getUserId());

        TournamentDTO tournamentDTO = tournamentService.findOne(t1.getTournamentId());

        List<UserDTO> winners = new ArrayList<>();
        winners.add(winner1);
        List<UserDTO> losers = new ArrayList<>();
        losers.add(looser1);

        GameDTO gameDTO = makeRandomGameDTO(winners,losers,tournamentDTO);
        try {
            gameService.validateGame(winner1, gameDTO);
        }catch ( APIException e){
            LOG.debug(e.toString());
            throw e;
        }
    }

    @Test
    public void validateGame_2vs2_success() {

        UserDTO winner1 = userService.findOne(u1.getUserId());
        UserDTO winner2 = userService.findOne(u2.getUserId());
        UserDTO looser1 = userService.findOne(u3.getUserId());
        UserDTO looser2 = userService.findOne(u4.getUserId());

        TournamentDTO tournamentDTO = tournamentService.findOne(t1.getTournamentId());
        List<UserDTO> winners = new ArrayList<>();
        winners.add(winner1);
        winners.add(winner2);
        List<UserDTO> losers = new ArrayList<>();
        losers.add(looser1);
        losers.add(looser2);

        GameDTO gameDTO = makeRandomGameDTO(winners,losers,tournamentDTO);
        gameService.validateGame(looser1, gameDTO);
    }

    @Test(expected = APIException.class)
    public void validateGame_2vs2_failure_1() {

        UserDTO winner1 = userService.findOne(u1.getUserId());
        UserDTO winner2 = userService.findOne(u2.getUserId());
        UserDTO winner3 = userService.findOne(u3.getUserId());
        UserDTO looser1 = userService.findOne(u4.getUserId());

        TournamentDTO tournamentDTO = tournamentService.findOne(t1.getTournamentId());

        List<UserDTO> winners = new ArrayList<>();
        winners.add(winner1);
        winners.add(winner2);
        winners.add(winner3);
        List<UserDTO> losers = new ArrayList<>();
        losers.add(looser1);

        GameDTO gameDTO = makeRandomGameDTO(winners,losers,tournamentDTO);
        try{
            gameService.validateGame(looser1, gameDTO);
        }catch ( APIException e){
            LOG.debug(e.toString());
            throw e;
        }
    }

    @Test(expected = APIException.class)
    public void validateGame_2vs2_failure_2() {

        UserDTO winner1 = userService.findOne(u1.getUserId());
        UserDTO winner2 = userService.findOne(u2.getUserId());
        UserDTO winner3 = userService.findOne(u3.getUserId());
        UserDTO looser1 = userService.findOne(u4.getUserId());

        TournamentDTO tournamentDTO = tournamentService.findOne(t1.getTournamentId());

        List<UserDTO> winners = new ArrayList<>();
        winners.add(winner1);
        winners.add(winner2);
        winners.add(winner3);
        List<UserDTO> losers = new ArrayList<>();
        losers.add(looser1);

        GameDTO gameDTO = makeRandomGameDTO(winners,losers,tournamentDTO);
        try{
            gameService.validateGame(winner1, gameDTO);
        }catch ( APIException e){
            LOG.debug(e.toString());
            throw e;
        }
    }

    @Test(expected = APIException.class)
    public void validateGame_2vs2_failure_3() {

        UserDTO winner1 = userService.findOne(u1.getUserId());
        UserDTO winner2 = userService.findOne(u2.getUserId());
        UserDTO winner3 = userService.findOne(u3.getUserId());
        UserDTO looser1 = userService.findOne(u4.getUserId());

        TournamentDTO tournamentDTO = tournamentService.findOne(t1.getTournamentId());

        List<UserDTO> winners = new ArrayList<>();
        winners.add(winner1);
        winners.add(winner2);
        winners.add(winner3);
        List<UserDTO> losers = new ArrayList<>();
        losers.add(looser1);
        losers.add(looser1);
        losers.add(looser1);

        GameDTO gameDTO = makeRandomGameDTO(winners,losers,tournamentDTO);
        try {
            gameService.validateGame(looser1, gameDTO);
        }catch ( APIException e){
            LOG.debug(e.toString());
            throw e;
        }
    }

    @Test(expected = APIException.class)
    public void validateGame_whenWinnerLoggedIn() {

        UserDTO winner = userServiceTest.makeRandomUserDTO();
        UserDTO looser = userServiceTest.makeRandomUserDTO();

        TournamentDTO tournamentDTO = tournamentServiceTest.makeRandomTournamentDTO(new SportDTO("sport"),userServiceTest.makeRandomUserDTO());
        GameDTO gameDTO = makeRandomGameDTO(winner,looser,tournamentDTO);

        gameService.validateGame(winner,looser,winner,tournamentDTO,gameDTO);
        //assertThat(false).isTrue();
    }

    @Test(expected = APIException.class)
    public void validateGame_whenOneOutcome() {

        UserDTO winner = userServiceTest.makeRandomUserDTO();
        UserDTO looser = userServiceTest.makeRandomUserDTO();

        TournamentDTO tournamentDTO = tournamentServiceTest.makeRandomTournamentDTO(new SportDTO("sport"),userServiceTest.makeRandomUserDTO());
        GameDTO gameDTO = makeRandomGameDTO(winner,looser,tournamentDTO);

        gameDTO.setOutcomes(gameDTO.getOutcomes().subList(0,0));

        gameService.validateGame(winner,looser,winner,tournamentDTO,gameDTO);
    }


    @Test(expected = APIException.class)
    public void validateGame_whenInvalidOutcome() {

        UserDTO winner = userServiceTest.makeRandomUserDTO();
        UserDTO looser = userServiceTest.makeRandomUserDTO();

        TournamentDTO tournamentDTO = tournamentServiceTest.makeRandomTournamentDTO(new SportDTO("sport"),userServiceTest.makeRandomUserDTO());
        GameDTO gameDTO = makeRandomGameDTO(winner,looser,tournamentDTO);

        gameDTO.getOutcomes().get(0).setResult(Outcome.Result.WIN);
        gameDTO.getOutcomes().get(1).setResult(Outcome.Result.WIN);

        gameService.validateGame(winner, looser, looser, tournamentDTO, gameDTO);
    }

    @Test
    public void sendPushNotificationPostGame(){
    }

    @Test
    public void convertToEntity() {
    }

    @Test
    public void convertToDto() {
    }

    public GameDTO makeRandomGameDTO(UserDTO winnerDTO, UserDTO looserDTO, TournamentDTO tournamentDTO) {
        double score = new Random().nextDouble()*10;

        ArrayList<OutcomeDTO> outcomes = new ArrayList<OutcomeDTO>();
        outcomes.add(new OutcomeDTO(winnerDTO, Outcome.Result.WIN,score));
        outcomes.add(new OutcomeDTO(looserDTO, Outcome.Result.LOSS,-score));

        GameDTO game = new GameDTO(tournamentDTO,outcomes);
        return game;
    }

    public GameDTO makeRandomGameDTO(List<UserDTO> winnersDTO, List<UserDTO> losersDTO, TournamentDTO tournamentDTO) {
        double score = new Random().nextDouble()*10;

        ArrayList<OutcomeDTO> outcomes = new ArrayList<OutcomeDTO>();

        for(UserDTO winnerDTO : winnersDTO){
            outcomes.add(new OutcomeDTO(winnerDTO, Outcome.Result.WIN,score));
        }
        for(UserDTO looserDTO : losersDTO){
            outcomes.add(new OutcomeDTO(looserDTO, Outcome.Result.LOSS,-score));
        }

        GameDTO game = new GameDTO(tournamentDTO,outcomes);
        return game;
    }

    public Game makeRandomGame(User winner, User looser, Tournament tournament) {
        double score = new Random().nextDouble()*10;
        Game g = new Game(tournament);
        g.setGameId(new Random().nextLong());

        ArrayList<Outcome> outcomes = new ArrayList<Outcome>();
        outcomes.add(new Outcome(score, Outcome.Result.WIN,g,winner));
        outcomes.add(new Outcome(-score, Outcome.Result.LOSS,g,looser));

        g.setOutcomes(outcomes);

        return g;
    }

    public Game makeRandomGame(List<User> winners, List<User> losers, Tournament tournament) {
        double score = new Random().nextDouble()*10;
        Game g = new Game(tournament);
        g.setGameId(new Random().nextLong());

        ArrayList<Outcome> outcomes = new ArrayList<Outcome>();
        for(User w : winners){
            outcomes.add(new Outcome(score, Outcome.Result.WIN,g,w));
        }
        for(User l : losers){
            outcomes.add(new Outcome(-score, Outcome.Result.LOSS,g,l));
        }

        LOG.debug("outcomes " + outcomes.size());
        LOG.debug("winners " + winners.size());
        LOG.debug("losers " + losers.size());

        g.setOutcomes(outcomes);

        return g;
    }
}
