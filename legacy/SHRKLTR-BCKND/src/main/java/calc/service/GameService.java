package calc.service;

import calc.DTO.*;
import calc.ELO.EloRating;
import calc.entity.*;
import calc.exception.APIException;
import calc.repository.GameRepository;
import calc.repository.StatsRepository;
import calc.repository.TournamentRepository;
import calc.repository.UserRepository;
import org.modelmapper.ModelMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.text.ParseException;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Created by clementperez on 9/20/16.
 */
@Service
public class GameService {

    @Autowired
    private GameRepository gameRepository;
    @Autowired
    private TournamentService tournamentService;
    @Autowired
    private TournamentRepository tournamentRepository;
    @Autowired
    private UserRepository userRepository;
    @Autowired
    private OutcomeService outcomeService;;
    @Autowired
    private UserService userService;
    @Autowired
    private StatsService statsService;
    @Autowired
    private RivalryStatsService rivalryStatsService;
    @Autowired
    private StatsRepository statsRepository;
    @Autowired
    private ModelMapper modelMapper;

    private Pageable createPageRequest(Optional<Integer> page, Optional<Integer> pageSize) {
        Integer DEFAULT_PAGE = 0;
        Integer DEFAULT_PAGE_SIZE = 30;

        Integer index = page.isPresent() ? page.get() : DEFAULT_PAGE;
        Integer size = pageSize.isPresent() ? pageSize.get() : DEFAULT_PAGE_SIZE;

        return new PageRequest(index, size);
    }

    public GameDTO findOne(Long gameId){
        return convertToDto(gameRepository.findOne(gameId));
    }

    public GameDTO addGame(TournamentDTO tournament, List<OutcomeDTO> outcomesWithoutScore) {

        System.out.print("outcome username : " +outcomesWithoutScore.get(0).getUser().getUsername() + " " + outcomesWithoutScore.get(1).getUser().getUsername() + "\n");

        List<OutcomeDTO> outcomesWithScore = outcomeService.setOutcomesValueForTournament(outcomesWithoutScore, tournament);

        /*
        double winnerSumScore = 0;
        double looserSumScore = 0;
        double tieSumScore = 0;

        for(OutcomeDTO o : outcomes){
            StatsDTO stats = statsService.findByUserNameAndTournament(o.getUser().getUsername(),tournament.getName());
            double score = stats != null ? stats.getScore() : 1000;
            if(o.isWin()){
                winnerSumScore += score;
            }else if(o.isLose()){
                looserSumScore += score;
            }else if(o.isTie()){
                tieSumScore += score;
            }
        }

        long winnersCount = outcomes.stream().filter(OutcomeDTO::isWin).count();
        long losersCount = outcomes.stream().filter(OutcomeDTO::isLose).count();

        double winnerMeanValue = winnerSumScore / winnersCount;//winnerStats.stream().flatMapToDouble(stats -> DoubleStream.of(stats.getScore())).average().getAsDouble();
        double looserMeanValue = looserSumScore / losersCount;//loserStats.stream().flatMapToDouble(stats -> DoubleStream.of(stats.getScore())).average().getAsDouble();
        //double tieMeanValue = tieSumScore / tiers.size();//tieStats.stream().flatMapToDouble(stats -> DoubleStream.of(stats.getScore())).average().getAsDouble();

        double pointValue = EloRating.calculatePointValue(
                winnerMeanValue,
                looserMeanValue,
                "+");

        for(OutcomeDTO o : outcomes){
            if(o.isWin()){
                o.setScoreValue(pointValue);
            }else if(o.isLose()){
                o.setScoreValue(-pointValue);
            }
        }*/

        GameDTO game = new GameDTO(tournament,outcomesWithScore);

        return save(game);
    }

    public GameDTO addGameLega(TournamentDTO tournament, List<OutcomeDTO> outcomes) {

        System.out.print("outcome username : " +outcomes.get(0).getUser().getUsername() + " " + outcomes.get(1).getUser().getUsername() + "\n");

        int winnerOutcomeIndex = outcomes.get(0).isWin() ? 0 : 1;
        int looserOutcomeIndex = outcomes.get(1).isWin() ? 0 : 1;
        Boolean isTie = outcomes.get(0).isTie();

        UserDTO w = userService.findByUserName(outcomes.get(winnerOutcomeIndex).getUser().getUsername());
        UserDTO l = userService.findByUserName(outcomes.get(looserOutcomeIndex).getUser().getUsername());

        if(w == null || l == null){
            throw new APIException(this.getClass(), "User " + outcomes.get(0).getUser().getUsername() + " OR " + outcomes.get(1).getUser().getUsername()  + " doesn't exist ", HttpStatus.NOT_FOUND);
        }

        StatsDTO winnerStats = statsService.findByUserNameAndTournament(w.getUsername(),tournament.getName());
        StatsDTO loserStats = statsService.findByUserNameAndTournament(l.getUsername(),tournament.getName());

        double pointValue = EloRating.calculatePointValue(
                winnerStats == null ? 1000 : winnerStats.getScore(),
                loserStats == null ? 1000 : loserStats.getScore(),
                isTie ? "=" : "+");

        //pointValue = 2 * pointValue;

        outcomes.get(winnerOutcomeIndex).setScoreValue(pointValue);
        outcomes.get(looserOutcomeIndex).setScoreValue(-pointValue);

        GameDTO game = new GameDTO(tournament,outcomes);

        return save(game);
    }

    public List<GameDTO> findByTournament(TournamentDTO tournament){
        if(tournamentService.findByName(tournament.getName()) == null){
            throw new APIException(Tournament.class,tournament.getName(),HttpStatus.NOT_FOUND);
        }

        return findByTournamentName(tournament.getName(), null);
    }

    public List<GameDTO> findByTournamentName(String tournamentName,Pageable page){
        if(tournamentService.findByName(tournamentName) == null){
            throw new APIException(Tournament.class,tournamentName,HttpStatus.NOT_FOUND);
        }
        return gameRepository.findByTournamentNameOrderByDateDesc(tournamentName, page).stream()
                .map(m -> convertToDto(m)).collect(Collectors.toList());
    }

    public List<GameDTO> findByUserIdByTournamentId(Long userId, Long tournamentId, Pageable page){
        if(tournamentService.findOne(tournamentId) == null){
            throw new APIException(Tournament.class,tournamentId+"",HttpStatus.NOT_FOUND);
        }
        if(userService.findOne(userId) == null){
            throw new APIException(User.class,userId+"",HttpStatus.NOT_FOUND);
        }
        return gameRepository.findByOutcomesUserUserIdAndTournamentTournamentId(userId, tournamentId, page).stream()
                .map(m -> convertToDto(m)).collect(Collectors.toList());
    }

    public List<GameDTO> findByUserByTournament(String username, String tournamentName, Pageable page){
        if(tournamentService.findByName(tournamentName) == null){
            throw new APIException(Tournament.class,tournamentName,HttpStatus.NOT_FOUND);
        }
        if(userService.findByUserName(username) == null){
            throw new APIException(User.class,username+"",HttpStatus.NOT_FOUND);
        }
        return gameRepository.findByOutcomesUserUserNameAndTournamentNameOrderByDateDesc(username, tournamentName, page).stream()
                .map(m -> convertToDto(m)).collect(Collectors.toList());
    }

    public List<GameDTO> findByUserId(Long userId, Pageable page) {
        if(userService.findOne(userId) == null){
            throw new APIException(User.class,userId+"",HttpStatus.NOT_FOUND);
        }
        return gameRepository.findByOutcomesUserUserId(userId, page).stream()
                .map(m -> convertToDto(m)).collect(Collectors.toList());
    }

    public List<GameDTO> findByUsername(String username, Pageable page) {
        if(userService.findByUserName(username) == null){
            throw new APIException(User.class,username+"",HttpStatus.NOT_FOUND);
        }
        return gameRepository.findByOutcomesUserUserNameOrderByDateDesc(username, page).stream().map(m -> convertToDto(m)).collect(Collectors.toList());
    }

    protected GameDTO saveTest(UserDTO loggedInUser ,GameDTO game){
        return this.save(loggedInUser,game);
    }

    public GameDTO save(GameDTO game){
        GameDTO gameDTO = this.save(userService.whoIsLoggedIn(),game);

        sendPushNotificationPostGame(gameDTO);
        return gameDTO;
    }

    private GameDTO save(UserDTO loggedInUser ,GameDTO game){

        this.validateGame(loggedInUser, game);

        Game g = null;

        try {
            g = convertToEntity(game);
        } catch (ParseException e) {
            e.printStackTrace();
        }

        // save the game then propagate the best/worst changes
        GameDTO gameDTO =  convertToDto(gameRepository.save(g));

        // add the game results to the stats
        statsRepository.save(statsService.recalculateAfterGame(g));
        // add the game results to the rivalry stats
        rivalryStatsService.recalculateAfterGame(g);

        return gameDTO;
    }

    protected void validateGame(UserDTO user_0, UserDTO user_1, UserDTO loggedIn, TournamentDTO tournament, GameDTO game) throws APIException{
        if(game.getOutcomes().size() != 2){
            throw new APIException(this.getClass(), game.getTournament().getName() + " Only two outcomes accepted " + game.getOutcomes().size() + " were provided", HttpStatus.BAD_REQUEST);
        }

        OutcomeDTO outcome_0 = game.getOutcomes().get(0);
        OutcomeDTO outcome_1 = game.getOutcomes().get(1);

        if(tournament == null){
            throw new APIException(this.getClass(), "Tournament " + game.getTournament().getName() + " doesn't exist ", HttpStatus.NOT_FOUND);
        }if(user_0 == null || user_1 == null){
            throw new APIException(this.getClass(), "User " + outcome_0.getUser().getUsername() + " OR " + outcome_1.getUser().getUsername()  + " doesn't exist ", HttpStatus.NOT_FOUND);
        }
        if(outcome_0.isWin() && outcome_1.isWin()
                || outcome_0.isLose() && outcome_1.isLose()
                || outcome_0.isLose() && !outcome_1.isWin()
                || outcome_0.isWin() && !outcome_1.isLose()){ //TODO double check this logic
            throw new APIException(this.getClass(), tournament.getName() + " Outcomes invalid - incompatible results", HttpStatus.BAD_REQUEST);
        }else if (user_0.getUserId() == user_1.getUserId()){
            throw new APIException(this.getClass(), tournament.getName() + " Same username for both outcomes", HttpStatus.BAD_REQUEST);
        }

        UserDTO w = outcome_0.isWin() ? user_0 : user_1;
        UserDTO l = outcome_1.isWin() ? user_0 : user_1;

        // for ties, the looser is the one with the highest score
        if(game.getOutcomes().get(0).isTie() && game.getOutcomes().get(1).isTie()){
            StatsDTO stats_0 = statsService.findByUserAndTournament(user_0.getUserId(), tournament.getTournamentId());
            StatsDTO stats_1 = statsService.findByUserAndTournament(user_1.getUserId(), tournament.getTournamentId());

            double score_0 = stats_0 == null ? 1000 : stats_0.getScore();
            double score_1 = stats_1 == null ? 1000 : stats_1.getScore();

            w = score_0 <= score_1 ? user_0 : user_1;
            l = score_0 <= score_1 ? user_1 : user_0;
        }

        if(l.getUserId() != loggedIn.getUserId()){
            throw new APIException(this.getClass(), tournament.getName() + " Only the one loosing points can enter a game", HttpStatus.UNAUTHORIZED);
        }

    }

    /**
     * This function validates every objects of the game and make sure that the object makes sense
     * If this function doesn't throw, it is safe to save the game.
     *
     * @param loggedIn          The logged in user
     * @param game              The game to validate
     * @throws APIException
     */
    protected void validateGame(UserDTO loggedIn, GameDTO game) throws APIException{

        if(game == null){
            throw new APIException(this.getClass(), "Game not provided ", HttpStatus.BAD_REQUEST);
        }else if(game.getOutcomes() == null){
            throw new APIException(this.getClass(), "Outcomes not provided ", HttpStatus.BAD_REQUEST);
        }else if(game.getTournament() == null){
            throw new APIException(this.getClass(), "Tournament not provided ", HttpStatus.BAD_REQUEST);
        }else if(tournamentService.findByName(game.getTournament().getName()) == null){
            throw new APIException(this.getClass(), "Tournament " + game.getTournament().getName() + " doesn't exist ", HttpStatus.NOT_FOUND);
        }

        long winnersCount = game.getOutcomes().stream().filter(o -> o.getResult() == Outcome.Result.WIN).count();
        long loosersCount = game.getOutcomes().stream().filter(o -> o.getResult() == Outcome.Result.LOSS).count();
        long tiersCount = game.getOutcomes().stream().filter(o -> o.getResult() == Outcome.Result.TIE).count();

        if(winnersCount != loosersCount){
            throw new APIException(this.getClass(), game.getTournament().getName() + " wrong number of outcomes provided " + game.getOutcomes().size() + " were provided", HttpStatus.BAD_REQUEST);
        }else if(tiersCount > 0 && tiersCount != game.getOutcomes().size()){
            throw new APIException(this.getClass(), game.getTournament().getName() + " Incompatible numbers of Ties", HttpStatus.BAD_REQUEST);
        }

        HashSet<Long> playerIds = new HashSet<>();
        for(OutcomeDTO o : game.getOutcomes()){
            UserDTO user = o.getUser();
            if(user == null){
                throw new APIException(this.getClass(), "User not provided for outcome", HttpStatus.BAD_REQUEST);
            }else if(!playerIds.add(o.getUser().getUserId())){
                throw new APIException(this.getClass(), "Multiple outcomes with same user " + o.getUser().getUsername() + "  ", HttpStatus.BAD_REQUEST);
            }
        }

        if(!game.getOutcomes().stream().filter(OutcomeDTO::isLose)
                .filter(o -> o.getUser().getUserId().equals(loggedIn.getUserId())).findFirst().isPresent()){
            throw new APIException(this.getClass(), game.getTournament().getName() + " Only the team loosing points can enter a game", HttpStatus.UNAUTHORIZED);
        }
    }

    private void sendPushNotificationPostGame(GameDTO g){
        int value = (int) Math.abs(g.getOutcomes().get(0).getScoreValue());

        try{
            List<OutcomeDTO> winnerOutcomes = g.getOutcomes().stream().filter(o -> o.getScoreValue() > 0).collect(Collectors.toList());
            List<OutcomeDTO> looserOutcomes = g.getOutcomes().stream().filter(o -> o.getScoreValue() < 0).collect(Collectors.toList());

            String looserUserNames = "";
            for (OutcomeDTO outcome : looserOutcomes) {
                looserUserNames = outcome.getUser().getUsername() + " " + looserUserNames;
            }

            for (OutcomeDTO outcome : winnerOutcomes) {
                userService.pushNotificationForUser(outcome.getUser().getUsername(),"Well done Champ !","You just got " + value  + " points from " + looserUserNames, g);
            }

        }catch (APIException e){
            // do nothing and return 200
        }
    }

    protected Game convertToEntity(GameDTO gameDto) throws ParseException {
        //modelMapper.getConfiguration().setAmbiguityIgnored(true);
        Game game = new Game(); //modelMapper.map(gameDto, Game.class);

        game.setGameId(gameDto.getGameId());
        game.setDate(gameDto.getDate());
        game.setTournament(tournamentRepository.findByName(gameDto.getTournament().getName()));

        List<Outcome> outcomeSet = gameDto.getOutcomes().stream()
                .map(o -> {
                    try {
                        return outcomeService.convertToEntity(o);
                    } catch (ParseException e) {
                        e.printStackTrace();
                    }
                    return null;
                }).collect(Collectors.toList());
        game.setOutcomes(outcomeSet);

        return game;
    }

    protected GameDTO convertToDto(Game game) {
        //modelMapper.getConfiguration().setAmbiguityIgnored(true);
        GameDTO gameDTO = new GameDTO();//modelMapper.map(game, GameDTO.class);

        gameDTO.setGameId(game.getGameId());
        gameDTO.setDate(game.getDate());
        gameDTO.setTournament(tournamentService.convertToDto(game.getTournament()));

        if (game.getGameId() != null)
            gameDTO.setOutcomes(game.getOutcomes().stream().map(o -> outcomeService.convertToDto(o) ).collect(Collectors.toList()));

        return gameDTO;
    }

}

